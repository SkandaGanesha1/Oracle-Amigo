/// <reference types="vitest/globals" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiRequestError, request } from "../api/localAgentClient";
import { getLocalUiSessionSnapshot, resetLocalUiSessionForTests } from "../api/localUiSessionStore";
import {
  getCloudUserSessionSnapshot,
  markCloudUserBlocked,
  reconcileCloudUserSessionFromStatus,
  resetCloudUserSessionForTests
} from "../api/cloudUserSessionStore";
import { safeExternalHref } from "../lib/safeUrl";
import { safeDisplayText } from "../lib/safeText";
import type { CloudStatus } from "../api/types";

const ROOT = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

type CloudStatusOverrides = Omit<Partial<CloudStatus>, "cloud"> & {
  cloud?: Partial<CloudStatus["cloud"]>;
};

function cloudStatus(overrides: CloudStatusOverrides = {}): CloudStatus {
  const { cloud: cloudOverrides, ...rest } = overrides;
  return {
    cloud: {
      profileId: "default",
      controlPlaneUrl: "http://127.0.0.1:8080",
      orgId: "org_test",
      userId: "usr_test",
      userEmail: "user@example.com",
      displayName: "Test User",
      deviceId: "dev_test",
      agentId: "agt_test",
      agentInstanceId: "agi_test",
      relayInboxUrl: "http://127.0.0.1:8080/v1/relay/a2a/inbox",
      status: "enrolled",
      hasUserAccessToken: true,
      hasDeviceAccessToken: true,
      hasRefreshToken: true,
      updatedAt: new Date(0).toISOString(),
      ...(cloudOverrides ?? {})
    },
    heartbeat: { running: true, lastResult: null, lastError: null },
    inbox: { running: true, lastItemCount: 0, lastError: null },
    tokenIssue: null,
    canRecoverDeviceToken: false,
    userAuthIssue: null,
    canRecoverUserToken: false,
    relayMode: "polling",
    ...rest
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetLocalUiSessionForTests();
  resetCloudUserSessionForTests();
});

describe("Sentry instrumentation", () => {
  it("installs and initializes Sentry before the React app renders", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
    const main = read("ui/src/main.tsx");
    const instrument = read("ui/src/instrument.ts");

    expect(pkg.dependencies).toHaveProperty("@sentry/react");
    expect(main.trimStart().startsWith('import "./instrument";')).toBe(true);
    expect(main).toContain("onUncaughtError: Sentry.reactErrorHandler()");
    expect(main).toContain("onCaughtError: Sentry.reactErrorHandler()");
    expect(main).toContain("onRecoverableError: Sentry.reactErrorHandler()");
    expect(instrument).toContain("Sentry.init");
    expect(instrument).toContain("import.meta.env.VITE_SENTRY_DSN");
    expect(instrument).toContain("const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN?.trim();");
    expect(instrument).not.toContain("ingest.us.sentry.io");
    expect(instrument).toContain("reactRouterV7BrowserTracingIntegration");
    expect(instrument).toContain("dataCollection");
    expect(instrument).toContain("tracesSampleRate: numberFromEnv(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 1.0)");
    expect(instrument).toContain("tracePropagationTargets");
    expect(instrument).toContain("\"localhost\"");
    expect(instrument).toContain("/^https:\\/\\/yourserver\\.io\\/api/");
  });

  it("captures custom render boundary failures without changing the fallback UI", () => {
    const boundary = read("ui/src/app/ErrorBoundary.tsx");
    const app = read("ui/src/App.tsx");

    expect(boundary).toContain("Sentry.captureException(error");
    expect(boundary).toContain("componentStack: info.componentStack");
    expect(boundary).toContain("Something went wrong");
    expect(app).toContain('import.meta.env.VITE_SENTRY_TEST_BUTTON !== "true"');
    expect(app).toContain("This is your first error!");
  });
});

describe("CSS compatibility source contracts", () => {
  it("keeps browser hint compatibility declarations out of authored source", () => {
    const styles = read("ui/src/styles.css");

    expect(styles).not.toContain("text-size-adjust");
  });

  it("keeps shell and chat backgrounds pure black", () => {
    const styles = read("ui/src/styles.css");
    const chatCanvas = styles.match(/\.oa-discord-chat-canvas\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const chatScroll = styles.match(/\.oa-chat-scroll\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const lightTheme = styles.match(/\[data-theme="light"\]\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(styles).toContain("--color-oa-bg: #000000");
    expect(styles).toContain("--color-oa-chat-bg: #000000");
    expect(styles).toContain("--background: #000000");
    expect(chatCanvas).toContain("background: #000000");
    expect(chatCanvas).not.toContain("radial-gradient");
    expect(chatScroll).toContain("background: #000000");
    expect(lightTheme).toContain("--oa-chat-bg: #000000");
    expect(lightTheme).toContain("--oa-chat-header-bg: #000000");
    expect(lightTheme).toContain("--oa-chat-panel-bg: #000000");
    expect(lightTheme).toContain("--oa-shell-bg: #000000");
  });
});

describe("localAgentClient", () => {
  it("does not add JSON content type to bodyless GET requests", async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.credentials).toBe("include");
      expect(headers.has("Content-Type")).toBe(false);
      expect(headers.has("x-local-agent-token")).toBe(false);
      expect(headers.has("Authorization")).toBe(false);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(request<{ ok: boolean }>("/health")).resolves.toEqual({ ok: true });
  });

  it("refreshes the local UI session once and retries protected requests without browser tokens", async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.credentials).toBe("include");
      expect(headers.has("x-local-agent-token")).toBe(false);
      expect(headers.has("Authorization")).toBe(false);
      if (fetchMock.mock.calls.length === 1) {
        expect(path).toBe("/chat/conversations");
        return new Response(JSON.stringify({ error: "UNAUTHORIZED", message: "Local agent API token is required" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (fetchMock.mock.calls.length === 2) {
        expect(path).toBe("/local-ui-session");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      expect(path).toBe("/chat/conversations");
      return new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(request<{ conversations: unknown[] }>("/chat/conversations")).resolves.toEqual({ conversations: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getLocalUiSessionSnapshot().status).toBe("ready");
  });

  it("blocks protected polling after local UI session recovery fails", async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(init?.credentials).toBe("include");
      expect(headers.has("x-local-agent-token")).toBe(false);
      expect(headers.has("Authorization")).toBe(false);
      if (fetchMock.mock.calls.length === 2) {
        expect(path).toBe("/local-ui-session");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      expect(path).toBe("/chat/conversations");
      return new Response(JSON.stringify({ error: "UNAUTHORIZED", message: "Local agent API token is required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/chat/conversations")).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 401,
      message: "Local agent API token is required"
    } satisfies Partial<ApiRequestError>);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getLocalUiSessionSnapshot()).toMatchObject({
      status: "blocked",
      message: "Local agent API token is required"
    });
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

describe("cloud user session store", () => {
  it("marks ready sessions from cloud status", () => {
    reconcileCloudUserSessionFromStatus(cloudStatus());

    expect(getCloudUserSessionSnapshot()).toMatchObject({
      status: "ready",
      issue: null,
      message: null
    });
  });

  it("blocks missing and expired cloud user sessions from cloud status", () => {
    reconcileCloudUserSessionFromStatus(cloudStatus({
      cloud: { hasUserAccessToken: false },
      userAuthIssue: "required"
    }));

    expect(getCloudUserSessionSnapshot()).toMatchObject({
      status: "blocked",
      issue: "required",
      message: "Please sign in to continue."
    });

    reconcileCloudUserSessionFromStatus(cloudStatus({
      cloud: { hasUserAccessToken: false },
      userAuthIssue: "expired"
    }));

    expect(getCloudUserSessionSnapshot()).toMatchObject({
      status: "blocked",
      issue: "expired",
      message: "Cloud login expired. Please sign in again."
    });
  });

  it("preserves cloud-auth expiry separately from local UI session state", () => {
    markCloudUserBlocked("expired", "Cloud login expired. Please sign in again.");

    expect(getCloudUserSessionSnapshot()).toMatchObject({
      status: "blocked",
      issue: "expired"
    });
    expect(getLocalUiSessionSnapshot().status).toBe("checking");
  });
});

describe("frontend hardening source contracts", () => {
  it("centralizes Motion React usage behind shared reduced-motion primitives", () => {
    const providers = read("ui/src/app/AppProviders.tsx");
    const primitives = read("ui/src/components/primitives/MotionPrimitives.tsx");
    const shell = read("ui/src/app/AppShell.tsx");
    const inboxList = read("ui/src/components/inbox/InboxItemList.tsx");
    const inboxDetail = read("ui/src/components/inbox/InboxDetailPanel.tsx");
    const intentInbox = read("ui/src/features/inbox/IntentFirstInbox.tsx");
    const command = read("ui/src/components/CommandPalette.tsx");
    const notifications = read("ui/src/components/notifications/NotificationCenter.tsx");
    const threadDrawer = read("ui/src/components/stream-like/ThreadDrawer.tsx");
    const missionThread = read("ui/src/features/missions/MissionThreadPanel.tsx");
    const missionTimeline = read("ui/src/features/missions/MissionTimeline.tsx");

    expect(providers).toContain("MotionConfig");
    expect(providers).toContain("reducedMotion=\"user\"");
    expect(primitives).toContain("from \"motion/react\"");
    expect(primitives).toContain("appShellVariants");
    expect(primitives).toContain("listItemVariants");
    expect(primitives).toContain("detailPanelVariants");
    expect(primitives).toContain("overlayVariants");
    expect(primitives).toContain("modalPanelVariants");
    expect(primitives).toContain("drawerVariants");
    expect(shell).toContain("appShellVariants");
    expect(shell).toContain("<main id=\"main-content\"");
    expect(shell).not.toContain("<m.main");
    expect(shell).toContain("data-app-route-content");
    expect(shell).toContain("<AnimatePresence initial={false} mode=\"popLayout\">");
    expect(inboxList).toContain("listContainerVariants");
    expect(inboxList).toContain("layout=\"position\"");
    expect(inboxDetail).toContain("detailPanelVariants");
    expect(inboxDetail).toContain("decisionActionMotion");
    expect(intentInbox).toContain("<AnimatePresence initial={false}>");
    expect(command).toContain("overlayVariants");
    expect(command).toContain("modalPanelVariants");
    expect(notifications).toContain("modalPanelVariants");
    expect(threadDrawer).toContain("drawerVariants");
    expect(missionThread).toContain("drawerVariants");
    expect(missionThread).not.toContain("animate={{ width:");
    expect(missionTimeline).toContain("missionStepVariants");
  });

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
    const localAgentClient = read("ui/src/api/localAgentClient.ts");
    const sharedMessage = read("components/ui/message.tsx");
    const intentChip = read("ui/src/features/chat/FileRequestIntentChip.tsx");
    const responseStream = read("components/ui/response-stream.tsx");
    const agentCodeBlock = read("ui/src/components/agentic-ai/AgentCodeBlock.tsx");
    const messageBubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const terminal = read("src/components/ai/terminal.tsx");
    const stackTrace = read("src/components/ai/stack-trace.tsx");
    const aiCodeBlock = read("src/components/ai/code-block.tsx");
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
    expect(localAgentClient).not.toContain("VITE_LOCAL_AGENT_API_TOKEN");
    expect(localAgentClient).not.toContain("ORACLE_AMIGO_LOCAL_AGENT_API_TOKEN");
    expect(localAgentClient).not.toContain("x-local-agent-token");
    expect(localAgentClient).toContain("credentials: \"include\"");
    expect(sharedMessage).toContain("safeMediaSrc(src)");
    expect(sharedMessage).not.toContain("<AvatarImage src={src}");
    expect(intentChip).toContain("Sending as file request");
    expect(intentChip).not.toContain("createObjectURL");
    expect(intentChip).not.toContain("simulateUpload");
    expect(responseStream).toContain("mountedRef");
    expect(responseStream).toContain("controller.signal.aborted || !mountedRef.current");
    for (const source of [agentCodeBlock, messageBubble, terminal, stackTrace, aiCodeBlock]) {
      expect(source).toContain("clearTimeout");
      expect(source).toContain("window.setTimeout");
    }
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
    const scrollState = read("ui/src/components/stream-like/timelineScrollState.ts");
    const typingState = read("ui/src/components/stream-like/typingState.ts");
    const chatWindow = read("ui/src/features/chat/ChatWindow.tsx");
    const hooks = read("ui/src/hooks/queries.ts");
    const chatApi = read("ui/src/api/chatApi.ts");
    const server = read("src/server.ts");
    const styles = read("ui/src/styles.css");
    expect(timeline).toContain("role=\"log\"");
    expect(timeline).toContain("aria-live=\"polite\"");
    expect(timeline).toContain("hasMoreBefore?: boolean");
    expect(timeline).toContain("jumpToMessageId?: string | null");
    expect(timeline).toContain("loadAroundMessage={loadAroundMessage}");
    expect(virtualized).toContain("useVirtualizer");
    expect(virtualized).toContain("estimateMessageSize");
    expect(scrollState).toContain("const timelineScrollByConversation = new Map<string, SavedTimelineScroll>();");
    expect(virtualized).toContain("saveTimelineScroll(conversationId");
    expect(virtualized).toContain("getTimelineScroll(conversationId)");
    expect(virtualized).toContain("getItemKey: (index) => messages[index]?.id ?? index");
    expect(virtualized).toContain("overscan: 16");
    expect(virtualized).toContain("contain: \"strict\"");
    expect(virtualized).toContain("overflowAnchor: \"none\"");
    expect(virtualized).toContain("loadBefore(firstMessage.id)");
    expect(chatApi).toContain("before?: string");
    expect(chatApi).toContain("params.set(\"before\", options.before)");
    expect(hooks).toContain("export function useLoadBeforeMessages");
    expect(hooks).toContain("before: beforeMessageId");
    expect(chatWindow).toContain("hasMoreBefore={pageInfo?.hasMoreBefore ?? false}");
    expect(server).toContain("before: z.string()");
    expect(server).toContain("getMessagesBefore");
    expect(virtualized).toContain("effectiveUnreadMessageId === message.id");
    expect(virtualized).toContain("interface LocalNewMessageState");
    expect(virtualized).toContain("firstNewMessageId");
    expect(virtualized).toContain("label=\"Unread messages\"");
    expect(virtualized).toContain("label=\"New messages\"");
    expect(virtualized).toContain("onMarkRead(newestMessageId)");
    expect(virtualized).toContain("jumpToMessageId");
    expect(virtualized).toContain("loadAroundMessage(jumpToMessageId)");
    expect(virtualized).toContain("oa-message-jump-highlight");
    expect(typingState).toContain("interface TypingState");
    expect(typingState).toContain("TYPING_TTL_MS = 6000");
    expect(typingState).toContain("removeExpiredTypingStates(Date.now())");
    expect(typingState).toContain("window.setInterval");
    expect(typingState).toContain("oa-typing-start");
    expect(chatWindow).toContain("useTypingStates(conversationId)");
    expect(virtualized).toContain("const showTyping = Boolean(typing)");
    expect(virtualized).toContain("className=\"flex gap-1\"");
    expect(virtualized).not.toContain("motion-safe:flex gap-1 hidden");
    expect(styles).toContain(".oa-message-jump-highlight");
    expect(styles).toContain("@keyframes oa-message-jump-pulse");
  });

  it("gates cloud contacts and local read-state behind valid session context", () => {
    const localAgentClient = read("ui/src/api/localAgentClient.ts");
    const main = read("ui/src/main.tsx");
    const localSessionStore = read("ui/src/api/localUiSessionStore.ts");
    const vite = read("vite.config.ts");
    const hooks = read("ui/src/hooks/queries.ts");
    const userRail = read("ui/src/app/UserRail.tsx");
    const sectionSidebar = read("ui/src/app/SectionSidebar.tsx");
    const intentInbox = read("ui/src/features/inbox/IntentInbox.tsx");
    const mainChat = read("ui/src/features/chat/MainChatLayout.tsx");
    const server = read("src/server.ts");

    expect(localAgentClient).toContain("credentials: \"include\"");
    expect(localAgentClient).toContain("refreshLocalUiSessionOnce");
    expect(localAgentClient).toContain("markLocalUiSessionRecovering");
    expect(localAgentClient).toContain("markLocalUiSessionBlocked");
    expect(localAgentClient).toContain("isLocalUiSessionUnauthorized");
    expect(localAgentClient).toContain("return error === \"UNAUTHORIZED\"");
    expect(localAgentClient).not.toContain("x-local-agent-token");
    expect(main).toContain("bootstrapLocalUiSession");
    expect(main).toContain("./api/localUiSessionStore");
    expect(main).toContain("SESSION_RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1000");
    expect(main).toContain("visibilitychange");
    expect(localSessionStore).toContain("\"/local-ui-session\"");
    expect(vite).toContain("cookieDomainRewrite");
    expect(vite).toContain("\"/local-ui-session\"");
    expect(hooks).toContain("export function isCloudUserReady");
    expect(hooks).toContain("useLocalUiSession");
    expect(hooks).toContain("isLocalUiSessionReady");
    expect(hooks).toContain("cloudStatus === \"authenticated\" || cloudStatus === \"enrolled\"");
    expect(hooks).toContain("status?.cloud.hasUserAccessToken === true || status?.canRecoverUserToken === true");
    expect(hooks).toContain("status?.userAuthIssue == null");
    expect(hooks).toContain("status?.tokenIssue !== \"expired\"");
    expect(hooks).toContain("function isCloudAuthError");
    expect(hooks).toContain("CLOUD_USER_TOKEN_EXPIRED");
    expect(hooks).toContain("CLOUD_USER_TOKEN_REQUIRED");
    expect(hooks).toContain("useCloudUserSession");
    expect(hooks).toContain("isCloudUserSessionReady");
    expect(hooks).toContain("markCloudUserBlocked");
    expect(hooks).toContain("reconcileCloudUserSessionFromStatus(query.data)");
    expect(hooks).toContain("function handleCloudAuthError");
    expect(hooks).toContain("queryClient.cancelQueries({ queryKey: queryKeys.contacts })");
    expect(hooks).toContain("queryClient.removeQueries({ queryKey: [\"directory\"] })");
    expect(hooks).toContain("normalizedQuery.length > 0");
    expect(hooks).toContain("refetchInterval: cloudEnabled ? 30000 : false");
    expect(hooks).toContain("staleTime: 15000");
    expect(hooks).toContain("retry: (failureCount, error) =>");
    expect(hooks).not.toContain("contactsAuthBlockedForStatusKey");
    expect(hooks).not.toContain("directoryAuthBlockedForStatusKey");
    expect(hooks).not.toContain("scheduleCloudStatusRefresh");
    expect(userRail).toContain("isCloudUserReady(cloudStatus)");
    expect(userRail).not.toContain("useDirectorySearch(\"\"");
    expect(sectionSidebar).toContain("useContacts(cloudContactsEnabled)");
    expect(sectionSidebar).toContain("isCloudUserReady(cloudStatus)");
    expect(intentInbox).toContain("useContacts(cloudContactsEnabled)");
    expect(intentInbox).toContain("isCloudUserReady(cloudStatus)");
    expect(mainChat).toContain("const canonicalConversationId = messagesData?.conversation?.id");
    expect(mainChat).toContain("useUpdateConversationReadState(canonicalConversationId)");
    expect(mainChat).toContain("if (!canonicalConversationId || updateReadState.isPending) return;");
    expect(server).toContain("id === \"local-agent\"");
    expect(server).toContain("getOrCreateLocalConversation");
    expect(server).toContain("function clearCloudUserTokens");
    expect(server).toContain("userAuthIssue");
    expect(server).toContain("canRecoverUserToken");
    expect(server).toContain("function runUserCloudRequest");
    expect(server).toContain("Cloud login expired. Please sign in again.");
    expect(server).toContain("userAccessToken: null");
    expect(server).toContain("userRefreshToken: null");
  });

  it("bounds realtime invalidation and active message polling", () => {
    const realtime = read("ui/src/realtime/RealtimeTransport.ts");
    const liveSync = read("ui/src/hooks/useActiveConversationLiveSync.ts");
    const hooks = read("ui/src/hooks/queries.ts");

    expect(realtime).toContain("function invalidateQueryWhenIdle");
    expect(realtime).toContain("queryClient.isFetching({ queryKey })");
    expect(realtime).toContain("cancel(): void");
    expect(realtime).not.toContain("flushAndStop");
    expect(realtime).toContain("eventSource.onopen = () => {");
    expect(realtime).toContain("this.stopFallbackPolling();");
    expect(realtime).toContain("this.invalidations.cancel();");
    expect(liveSync).toContain("eventConversationId === conversationId");
    expect(liveSync).not.toContain("conversationId === \"*\"");
    expect(hooks).toContain("document.visibilityState === \"visible\" ? 2000 : 15000");
  });

  it("renders message attachments and embeds through safe media previews", () => {
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const attachments = read("ui/src/components/stream-like/MessageAttachments.tsx");
    const embeds = read("ui/src/components/stream-like/MessageEmbeds.tsx");
    const media = read("ui/src/components/stream-like/SafeMediaPreview.tsx");
    const safeUrl = read("ui/src/lib/safeUrl.ts");

    expect(bubble).toContain("<MessageAttachments attachments={message.attachments}");
    expect(bubble).toContain("<MessageEmbeds embeds={message.embeds}");
    expect(attachments).toContain("<SafeMediaPreview");
    expect(embeds).toContain("safeExternalHref");
    expect(media).toContain("safeMediaSrc(url)");
    expect(media).toContain("safeExternalHref(url)");
    expect(safeUrl).toContain("export function safeMediaSrc");
    expect(safeUrl).toContain("SAFE_DATA_IMAGE_TYPES");
  });

  it("renders ordinary chat as flat chat message rows while preserving structured cards", () => {
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const virtualized = read("ui/src/components/stream-like/VirtualizedMessageList.tsx");
    const timelineModel = read("ui/src/components/stream-like/timelineModel.ts");
    const styles = read("ui/src/styles.css");
    const server = read("src/server.ts");
    const types = read("ui/src/types.ts");
    const chat = read("ui/src/features/chat/ChatWindow.tsx");
    const attachments = read("ui/src/components/stream-like/MessageAttachments.tsx");
    const embeds = read("ui/src/components/stream-like/MessageEmbeds.tsx");
    const media = read("ui/src/components/stream-like/SafeMediaPreview.tsx");
    const rich = read("ui/src/components/stream-like/RichMessageContent.tsx");

    expect(types).toContain("export interface TimelineMessageMeta");
    expect(types).toContain("origin_side?: MessageOriginSide");
    expect(types).toContain("export interface MessageAttachment");
    expect(types).toContain("scan_state: \"pending\" | \"clean\" | \"blocked\" | \"unknown\"");
    expect(types).toContain("export interface MessageEmbed");
    expect(types).toContain("safety_state: \"safe\" | \"blocked\" | \"unknown\"");
    expect(server).toContain("function timelineMeta");
    expect(server).toContain("pageInfo:");
    expect(server).toContain("readState:");
    expect(server).toContain("\"/chat/conversations/:id/read-state\"");
    expect(virtualized).toContain("buildTimelineMeta(messages)");
    expect(virtualized).toContain("isHiddenTimelineMessage");
    expect(virtualized).toContain("messages.filter((message) => !isHiddenTimelineMessage(message))");
    expect(virtualized).toContain("readState={readState}");
    expect(virtualized).toContain("meta={rowMeta}");
    expect(timelineModel).toContain("export function shouldGroupWithPrevious");
    expect(timelineModel).toContain("export function getUnreadMessageId");
    expect(timelineModel).toContain("export function messageSide");
    expect(timelineModel).toContain("message.kind === \"thinking_bar\"");
    expect(bubble).toContain("isStructuredCard");
    expect(bubble).toContain("data-side={side}");
    expect(bubble).toContain("data-card={isStructuredCard ? \"true\" : \"false\"}");
    expect(bubble).toContain("data-grouped={groupedWithPrevious ? \"true\" : \"false\"}");
    expect(bubble).toContain("oa-message-row");
    expect(bubble).toContain("oa-message-main");
    expect(bubble).toContain("oa-message-header");
    expect(bubble).toContain("oa-message-surface-text");
    expect(bubble).toContain("oa-message-surface-card");
    expect(bubble).toContain("This message was deleted.");
    expect(bubble).toContain("moderationPlaceholder");
    expect(bubble).toContain("ReactionPills");
    expect(bubble).toContain("<ApprovalCardMessage");
    expect(bubble).not.toContain("file_request_rejected: \"File request rejected\"");
    expect(bubble).toContain("<TransferProgressCard");
    expect(bubble).toContain("isCompletedTransferMessage");
    expect(bubble).toContain("[\"stored\", \"available\"].includes");
    expect(bubble).toContain("return null");
    expect(bubble).toContain("<FileRequestCard");
    expect(bubble).toContain("oa-message-content");
    expect(virtualized).toContain("className=\"oa-chat-scroll absolute inset-0\"");
    expect(virtualized).toContain("className=\"oa-chat-lane\"");
    expect(attachments).toContain("scanState={attachment.scan_state}");
    expect(embeds).toContain("embed.safety_state === \"safe\"");
    expect(media).toContain("Scanning attachment...");
    expect(media).toContain("blocked by safety scan");
    expect(rich).toContain("renderInlineTokens");
    expect(rich).toContain("oa-message-token");
    expect(styles).toContain(".oa-message-content");
    expect(styles).toContain(".oa-chat-lane");
    expect(styles).toContain(".oa-message-row[data-side=\"right\"]");
    expect(styles).toContain(".oa-message-row[data-grouped=\"true\"]");
    expect(styles).toContain(".oa-message-surface-text");
    expect(styles).toContain(".oa-message-surface-card");
    expect(chat).toContain("sendAs === \"normal\"");
    expect(chat).toContain("clientMessageId: crypto.randomUUID()");
    expect(chat).toContain("setPendingSend({ text, sendAs, clientMessageId: crypto.randomUUID() })");
  });

  it("keeps chat polling stable with structural message sharing", () => {
    const hooks = read("ui/src/hooks/queries.ts");
    const liveSync = read("ui/src/hooks/useActiveConversationLiveSync.ts");
    expect(hooks).toContain("function shallowEqualRecord");
    expect(hooks).toContain("function structurallyShareMessages");
    expect(hooks).toContain("document.visibilityState === \"visible\" ? 2000 : 15000");
    expect(hooks).toContain("refetchIntervalInBackground: true");
    expect(hooks).toContain("refetchOnMount: \"always\"");
    expect(hooks).toContain("refetchOnReconnect: true");
    expect(hooks).toContain("networkMode: \"always\"");
    expect(hooks).toContain("structuralSharing: structurallyShareMessages");
    expect(liveSync).toContain("window.addEventListener(\"oa-realtime-event\"");
    expect(liveSync).toContain("queryKeys.conversationMessages(conversationId)");
    expect(liveSync).toContain("queryKeys.conversations");
    expect(liveSync).not.toContain("messagesQuery.refetch()");
  });

  it("keeps file transfer review focused on risk, integrity, and ordered actions", () => {
    const preview = read("ui/src/components/stream-like/DocumentPreviewCard.tsx");
    const approval = read("ui/src/components/agentic-ai/ApprovalCardMessage.tsx");
    const socialPostCard = read("components/ui/social-post-card.tsx");
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const receipt = read("ui/src/components/agentic-ai/FileReceiptMessage.tsx");
    const chat = read("ui/src/features/chat/ChatWindow.tsx");
    const unreadDivider = read("ui/src/components/stream-like/UnreadDivider.tsx");
    const styles = read("ui/src/styles.css");

    expect(preview).toContain("decodeFileName");
    expect(preview).toContain("decodeURIComponent(name)");
    expect(preview).toContain("Hash verified");
    expect(preview).toContain("Leaves device");
    expect(preview).not.toContain("pending approval");
    expect(approval).toContain("Review file transfer");
    expect(approval).toContain("BorderRotate");
    expect(approval).toContain("SocialPostCard");
    expect(approval).toContain("oa-approval-gradient-border");
    expect(approval).toContain("label: \"Send\"");
    expect(approval).toContain("label: \"Deny\"");
    expect(approval).toContain("label: \"Feedback\"");
    expect(approval).toContain("CheckCircle2");
    expect(approval).toContain("XCircle");
    expect(approval).toContain("MessageSquareText");
    expect(approval).not.toContain("oa-candidate-list");
    expect(approval).not.toContain("No candidate files found");
    expect(approval).not.toContain("Choose indexed file");
    expect(approval).not.toContain("useIndexedFiles");
    expect(approval).not.toContain("useRebindApprovalFile");
    expect(approval).not.toContain("PreviewButton");
    expect(approval).not.toContain("View audit");
    expect(approval).not.toContain("RiskSummary");
    expect(approval).not.toContain("oa-risk-pill");
    expect(socialPostCard).toContain("Tooltip");
    expect(socialPostCard).toContain("TooltipTrigger asChild");
    expect(socialPostCard).toContain("TooltipContent side=\"top\"");
    expect(socialPostCard).not.toContain("@heroui/react");
    expect(socialPostCard).not.toContain("Tooltip.Trigger");
    expect(unreadDivider).toContain("role=\"separator\"");
    expect(unreadDivider).toContain("aria-label={label}");
    expect(unreadDivider.indexOf("role=\"separator\"")).toBeLessThan(unreadDivider.indexOf("aria-label=\"Jump to latest messages\""));
    expect(socialPostCard).toContain("max-w-lg");
    expect(socialPostCard).toContain("rounded-3xl");
    expect(socialPostCard).toContain("bg-[#18181d]");
    expect(socialPostCard).toContain("px-7 pt-6");
    expect(socialPostCard).toContain("h-14 w-14");
    expect(socialPostCard).toContain("aspect-square");
    expect(socialPostCard).toContain("border-white/[0.08]");
    expect(socialPostCard).toContain("divide-white/[0.08]");
    expect(socialPostCard).toContain("min-h-[64px]");
    expect(socialPostCard).toContain("grid grid-cols-3");
    expect(socialPostCard).toContain("focus-visible:ring-inset");
    expect(socialPostCard).not.toContain("OracleAvatar");
    expect(socialPostCard).not.toContain("border-zinc-200");
    expect(socialPostCard).not.toContain("border-zinc-700");
    expect(socialPostCard).not.toContain("Heart");
    expect(socialPostCard).not.toContain("Share2");
    expect(bubble).toContain("oa-message-surface-social-approval");
    expect(receipt).toContain("View audit");
    expect(receipt).not.toContain("Needs review\"}</span>");
    expect(chat).toContain("ConnectionStatusStrip");
    expect(chat).toContain("Agent link active");
    expect(styles).toContain(".oa-message-surface-social-approval");
    expect(styles).toContain("max-width: min(34rem, calc(100vw - 96px));");
    expect(styles).toContain(".animated-gradient-border");
    expect(styles).toContain(".animated-gradient-border__layer");
    expect(styles).toContain(".animated-gradient-border__content");
    expect(styles).toContain(".oa-approval-gradient-border");
    expect(styles).toContain("animated-gradient-border-spin");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain(".oa-risk-summary");
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
    expect(routedSources).toContain("<IntentFirstInbox />");
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
    const shell = read("ui/src/app/AppShell.tsx");
    const section = read("ui/src/app/SectionContext.tsx");
    const sidebar = read("ui/src/app/SectionSidebar.tsx");
    expect(routes).toContain("path=\"/inbox\"");
    expect(routes).toContain("to=\"/inbox\"");
    expect(shell).not.toContain("NavBar");
    expect(nav).not.toContain("{ id: \"inbox\"");
    expect(rail).toContain("navigate(\"/inbox\")");
    expect(section).toContain("inbox: \"Inbox\"");
    expect(sidebar).toContain("if (section === \"inbox\") return null;");
    expect(sidebar).not.toContain("<IntentInbox");
  });

  it("renders inbox as an action center backed by the inbox API", () => {
    const page = read("ui/src/pages/InboxPage.tsx");
    const actionCenter = read("ui/src/features/inbox/IntentFirstInbox.tsx");
    const bucketRail = read("ui/src/components/inbox/InboxBucketRail.tsx");
    const inboxApi = read("ui/src/api/inboxApi.ts");
    const hooks = read("ui/src/hooks/queries.ts");
    const detail = read("ui/src/components/inbox/InboxDetailPanel.tsx");
    const empty = read("ui/src/components/inbox/InboxEmptyState.tsx");
    const shell = read("ui/src/components/inbox/InboxShell.tsx");
    const row = read("ui/src/components/inbox/InboxItemRow.tsx");

    expect(page).toContain("<IntentFirstInbox />");
    expect(actionCenter).toContain("<InboxBucketRail");
    expect(bucketRail).toContain("Action Center");
    expect(page).not.toContain("MemoryInspector");
    expect(page).not.toContain("A2AOrchestrationGraph");
    expect(page).not.toContain("ArtifactRenderer");
    expect(actionCenter).toContain("useInboxItems(params)");
    expect(actionCenter).toContain("const selectedItem = items.find((item) => item.id === selectedId) ?? items[0] ?? null");
    expect(actionCenter).toContain("window.addEventListener(\"keydown\"");
    expect(actionCenter).toContain("searchRef.current?.focus()");
    expect(actionCenter).toContain("navigate(`/chats/${item.conversationId}`)");
    expect(actionCenter).toContain("detailOpen={Boolean(selectedItem)}");
    expect(actionCenter).toContain("No approvals pending");
    expect(actionCenter).toContain("BucketAwareEmptyState");
    expect(actionCenter).not.toContain("Intent-first inbox");
    expect(inboxApi).toContain("/api/inbox/items");
    expect(hooks).toContain("export function useInboxItemAction");
    expect(empty).toContain("All clear");
    expect(empty).toContain("title = \"All clear\"");
    expect(shell).toContain("data-detail-open");
    expect(detail).toContain("Masked by privacy mode");
    expect(detail).toContain("if (!item) return null;");
    expect(detail).toContain("InboxRiskSummary");
    expect(detail).toContain("oa-inbox-action-bar");
    expect(row).toContain("oa-inbox-row");
    expect(row).not.toContain("<ActionableCard");
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
    expect(inbox).toContain("<IntentFirstInbox />");
    expect(inbox).not.toContain("<MemoryInspector />");
    expect(inbox).not.toContain("<ArtifactRenderer");
    expect(inbox).not.toContain("<A2AOrchestrationGraph");
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
    const pkg = read("package.json");
    const store = read("ui/src/lib/messageReactions.ts");
    const actions = read("ui/src/components/stream-like/MessageActions.tsx");
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const composer = read("ui/src/components/stream-like/MessageComposer.tsx");
    expect(pkg).toContain("emoji-picker-react");
    expect(store).toContain("oa-message-reactions-v1");
    expect(store).toContain("useSyncExternalStore");
    expect(store).toContain("LEGACY_REACTION_MAP");
    expect(store).toContain("like: \"👍\"");
    expect(actions).toContain("useMessageReactions(messageId)");
    expect(actions).toContain("EmojiPicker");
    expect(actions).toContain("QUICK_REACTIONS");
    expect(actions).toContain("👍");
    expect(actions).toContain("allowExpandReactions");
    expect(actions).toContain("onEmojiClick");
    expect(actions).not.toContain("toggleReaction(\"like\")");
    expect(bubble).toContain("mergeReactions(message.reactions, localReactions)");
    expect(composer).toContain("EmojiPicker");
    expect(composer).toContain("insertEmoji");
    expect(composer).toContain("onEmojiClick");
    expect(actions).toContain("oa-message-hover-toolbar");
    expect(actions).toContain("DropdownMenu.Content");
    expect(actions).not.toContain("min-h-[48px]");
  });

  it("uses compact chat header, composer, and document preview cards", () => {
    const main = read("ui/src/main.tsx");
    const header = read("ui/src/features/chat/ConversationHeader.tsx");
    const profileCard = read("ui/src/features/chat/ConversationProfileCard.tsx");
    const composer = read("ui/src/components/stream-like/MessageComposer.tsx");
    const docCard = read("ui/src/components/stream-like/DocumentPreviewCard.tsx");
    const fileRequest = read("ui/src/components/agentic-ai/FileRequestMessage.tsx");
    const approval = read("ui/src/components/agentic-ai/ApprovalCardMessage.tsx");
    const confirmation = read("components/ai-elements/confirmation.tsx");
    const transfer = read("ui/src/components/agentic-ai/TransferProgressMessage.tsx");
    const receipt = read("ui/src/components/agentic-ai/FileReceiptMessage.tsx");
    const styles = read("ui/src/styles.css");
    expect(header).toContain("oa-chat-header");
    expect(header).toContain("oa-chat-header-identity");
    expect(header).toContain("oa-rail-avatar-anchor");
    expect(header).toContain("oa-rail-avatar h-10 w-10 rounded-full");
    expect(header).toContain("oa-rail-presence-badge");
    expect(header).toContain("local ? \"MY\" : initialsFor(displayTitle)");
    expect(header).toContain("oa-chat-header-search");
    expect(header).toContain("oa-open-chat-search");
    expect(header).toContain("Dialog");
    expect(header).toContain("DialogTrigger");
    expect(header).toContain("DialogContent");
    expect(header).toContain("DialogTitle");
    expect(header).toContain("DialogDescription");
    expect(header).toContain("ConversationProfileCard");
    expect(header).toContain("Open ${displayTitle} profile card");
    expect(header).toContain("normalizePeerPresence(conversation)");
    expect(profileCard).toContain("OracleAvatar");
    expect(profileCard).toContain("import { Badge } from \"@heroui/react\"");
    expect(profileCard).toContain("DialogClose");
    expect(profileCard).toContain("Close profile card");
    expect(profileCard).toContain("oa-conversation-profile-close");
    expect(profileCard).not.toContain("oa-conversation-profile-status");
    expect(profileCard).not.toContain("max-w-sm");
    expect(profileCard).not.toContain("h-40");
    expect(profileCard).not.toContain("w-24");
    expect(profileCard).not.toContain("h-24");
    expect(profileCard).toContain("rounded-[2rem]");
    expect(profileCard).toContain("oa-conversation-profile-card");
    expect(profileCard).toContain("oa-conversation-profile-cover");
    expect(profileCard).toContain("oa-conversation-profile-avatar");
    expect(profileCard).toContain("Badge.Anchor");
    expect(profileCard).toContain("oa-conversation-profile-avatar-anchor");
    expect(profileCard).toContain("size=\"md\"");
    expect(profileCard).not.toContain("size=\"lg\"");
    expect(profileCard).toContain("placement=\"bottom-right\"");
    expect(profileCard).toContain("oa-conversation-profile-avatar-image");
    expect(profileCard).toContain("oa-conversation-profile-presence");
    expect(profileCard).toContain("Active");
    expect(profileCard).toContain("local time");
    expect(profileCard).toContain("emailOrDetail");
    expect(profileCard).toContain("Documents");
    expect(profileCard).toContain("Media");
    expect(profileCard).toContain("Links");
    expect(styles).toContain(".oa-conversation-profile-dialog");
    expect(styles).toContain("left: 50% !important");
    expect(styles).toContain("top: 50% !important");
    expect(styles).toContain("transform: translate(-50%, -50%) !important");
    expect(styles).toContain(".oa-conversation-profile-presence");
    expect(styles).toContain("background: #151515");
    expect(styles).toContain("border: 1px solid rgba(255, 255, 255, 0.08)");
    expect(styles).toContain(".oa-conversation-profile-close");
    expect(styles).toContain("width: 36.625rem !important");
    expect(styles).toContain("max-width: calc(100vw - 16px) !important");
    expect(styles).toContain("min-height: 50.375rem");
    expect(styles).toContain("height: 15.25rem");
    expect(styles).toContain("--oa-conversation-profile-avatar-size: 5rem");
    expect(styles).toContain("width: var(--oa-conversation-profile-avatar-size)");
    expect(styles).toContain("height: var(--oa-conversation-profile-avatar-size)");
    expect(styles).toContain("border: 4px solid #151515");
    expect(styles).toContain(".oa-conversation-profile-avatar-anchor");
    expect(styles).toContain(".oa-conversation-profile-avatar-anchor > .oa-conversation-profile-presence.badge--bottom-right");
    expect(styles).toContain("position: absolute !important");
    expect(styles).toContain("top: auto !important");
    expect(styles).toContain("width: 16px !important");
    expect(styles).toContain("height: 16px !important");
    expect(styles).toContain("right: 4px");
    expect(styles).toContain("bottom: 4px");
    expect(styles).toContain("left: auto !important");
    expect(styles).toContain("transform: none !important");
    expect(styles).toContain(".oa-conversation-profile-meta");
    expect(styles).toContain(".oa-conversation-profile-actions");
    expect(styles).not.toContain(".oa-conversation-profile-status");
    expect(styles).not.toContain("left: 0.15rem");
    expect(header).not.toContain("PopoverContent");
    expect(header).not.toContain("presence.label");
    expect(header).not.toContain("oa-chat-header-toolbar");
    expect(header).not.toContain("oa-chat-header-subline");
    expect(header).not.toContain("oa-open-pinned-messages");
    expect(header).not.toContain("oa-open-chat-activity");
    expect(header).not.toContain("oa-open-security-context");
    expect(header).not.toContain("oa-open-chat-actions");
    expect(header).not.toContain("aria-controls=\"right-inspector-panel\"");
    expect(header).not.toContain("Phone");
    expect(header).not.toContain("Video");
    expect(header).not.toContain("UserPlus");
    expect(header).not.toContain("Members");
    expect(header).not.toContain("Notifications");
    expect(header).not.toContain("Voice input");
    expect(profileCard).not.toContain("Follow");
    expect(profileCard).not.toContain("Followers");
    expect(profileCard).not.toContain("Following");
    expect(profileCard).not.toContain("Likes");
    expect(profileCard).not.toContain("Posts");
    expect(profileCard).not.toContain("Views");
    expect(profileCard).not.toContain("Instagram");
    expect(profileCard).not.toContain("Twitter");
    expect(profileCard).not.toContain("Threads");
    expect(profileCard).not.toContain("exp.");
    expect(confirmation).toContain("export const Confirmation");
    expect(confirmation).toContain("export const ConfirmationAccepted");
    expect(confirmation).toContain("export const ConfirmationRejected");
    expect(confirmation).toContain("export const ConfirmationRequest");
    expect(confirmation).toContain("export const ConfirmationTitle");
    expect(approval).toContain("@/components/ai-elements/confirmation");
    expect(approval).toContain("<Confirmation");
    expect(approval).toContain("approval={{ approved: isApproved, id: card.approval_id }}");
    expect(approval).toContain("state={isApproved ? \"approval-responded\" : \"output-denied\"}");
    expect(approval).toContain("You approved this file transfer");
    expect(approval).toContain("You rejected this file transfer");
    expect(main).toContain('import "@fontsource/inter/400.css"');
    expect(main).toContain('import "@fontsource/inter/500.css"');
    expect(main).toContain('import "@fontsource/inter/600.css"');
    expect(main).toContain('import "@fontsource/inter/700.css"');
    expect(composer).toContain("oa-composer-dock");
    expect(composer).toContain("oa-composer-frame");
    expect(composer).toContain("oa-composer-glow-shell");
    expect(composer).toContain("oa-composer-glow-layer");
    expect(composer).toContain("aria-hidden=\"true\"");
    expect(composer).toContain("oa-composer-action-row");
    expect(composer).toContain("ComposerDivider");
    expect(composer).toContain("Paperclip");
    expect(composer).toContain("Command");
    expect(composer).toContain("Smile");
    expect(composer).toContain("Mic");
    expect(composer).toContain("StopCircle");
    expect(composer).toContain("ArrowUp");
    expect(composer).toContain("Open command bar");
    expect(composer).toContain("EmojiPicker");
    expect(composer).toContain("oa-composer-send");
    expect(composer).toContain("data-oa-composer-input");
    expect(composer).not.toContain("SuggestedPrompts");
    expect(composer).not.toContain("DEFAULT_SUGGESTED_PROMPTS");
    expect(composer).not.toContain("oa-composer-quick-actions");
    expect(composer).not.toContain("Globe");
    expect(composer).not.toContain("BrainCog");
    expect(composer).not.toContain("FolderCode");
    expect(composer).not.toContain("showSearch");
    expect(composer).not.toContain("showThink");
    expect(composer).not.toContain("showCanvas");
    expect(composer).not.toContain("HuddleButton");
    expect(composer).not.toContain("Start huddle");
    expect(composer).not.toContain("Voice input");
    expect(docCard).toContain("export interface ChatDocumentPreview");
    expect(fileRequest).toContain("oa-agent-card compact");
    expect(approval).toContain("<BorderRotate");
    expect(approval).toContain("<SocialPostCard");
    expect(transfer).toContain("<DocumentPreviewCard");
    expect(receipt).toContain("<DocumentPreviewCard");
    expect(styles).toContain(".oa-doc-card");
    expect(styles).toContain(".oa-message-hover-toolbar");
    expect(styles).toContain(".oa-composer-dock");
    expect(styles).toContain(".oa-composer-glow-shell");
    expect(styles).toContain(".oa-composer-glow-layer");
    expect(styles).toContain("background: #000000");
    expect(styles).toMatch(/\.oa-message-surface-card\s*\{[\s\S]*?background: #1C1C21;/);
    expect(styles).toMatch(/\.oa-approval-gradient-border \.oa-social-approval-card\s*\{[\s\S]*?background: #1C1C21;/);
    expect(styles).toMatch(/\.oa-agent-card-panel\s*\{[\s\S]*?background: #1C1C21;/);
    expect(styles).toMatch(/\.oa-connection-strip\s*\{[\s\S]*?background: #1C1C21;/);
    expect(styles).toMatch(/\.oa-user-rail\s*\{[\s\S]*?background-color: #000000;/);
    expect(styles).toMatch(/\.oa-composer-frame\s*\{[\s\S]*?background: #000000;/);
    expect(styles).toContain("oa-composer-glow-spin");
    expect(styles).toContain("conic-gradient");
    expect(styles).toContain("min-height: 152px");
    expect(styles).toContain("min-height: 204px");
    expect(styles).toContain("min-height: 148px");
    expect(styles).toContain("min-height: 200px");
    expect(styles).toContain("min-height: 64px");
    expect(styles).toContain("width: 48px");
    expect(styles).toContain("height: 48px");
    expect(styles).toContain("height: 34px");
    expect(styles).toContain("width: 2px");
    expect(styles).toContain("width: 2px");
    expect(styles).toContain("height: 40px");
    expect(styles).toContain("--font-sans: Inter");
    expect(styles).toContain("font-family: var(--font-sans)");
    expect(styles).toContain("font-size: 26px");
    expect(styles).toContain("line-height: 32px");
    expect(styles).toContain(".oa-composer-input::placeholder");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).not.toContain(".oa-composer-frame::before");
    expect(styles).not.toContain(".oa-composer-frame::after");
    expect(styles).not.toContain(".oa-composer-quick-actions");
    const uiIndex = read("ui/index.html");
    const publicIndex = read("public/index.html");
    const fontSources = [main, styles, uiIndex, publicIndex].join("\n");
    expect(fontSources).not.toContain("fonts.googleapis.com");
    expect(fontSources).not.toContain("fonts.gstatic.com");
    expect(fontSources).not.toContain("@import url(");
    expect(styles).toContain(".oa-chat-header");
    expect(styles).toContain(".oa-chat-header-identity");
    expect(styles).toContain(".oa-chat-header-search input");
    expect(styles).toContain(".oa-message-author");
    expect(styles).toContain("font-size: 19px");
    expect(styles).toContain("line-height: 19px");
    expect(styles).toContain(".oa-message-time");
    expect(styles).toContain("font-size: 14px");
    expect(styles).toContain("line-height: 16px");
    expect(styles).toContain(".oa-message-surface-text");
    expect(styles).toContain(".rich-message");
    expect(styles).toContain("font-size: 22px");
    expect(styles).toContain("line-height: 33px");
    expect(styles).toContain(".oa-rail-tooltip");
    expect(styles).toContain(".oa-rail-tooltip-label");
    expect(styles).toContain(".oa-rail-tooltip-user");
  });

  it("uses prompt-kit thinking components and keeps chat approval cards lean", () => {
    const promptThinking = read("components/prompt-kit/thinking-bar.tsx");
    const promptChain = read("components/prompt-kit/chain-of-thought.tsx");
    const promptShimmer = read("components/prompt-kit/text-shimmer.tsx");
    const agentThinking = read("ui/src/components/agentic-ai/ThinkingBar.tsx");
    const chatThinking = read("ui/src/components/chat/ThinkingBar.tsx");
    const agentRun = read("ui/src/components/agentic-ai/AgentRunCard.tsx");
    const typing = read("ui/src/components/stream-like/TypingIndicator.tsx");
    const approval = read("ui/src/components/agentic-ai/ApprovalCardMessage.tsx");
    const consent = read("ui/src/features/approvals/ConsentConsole.tsx");

    expect(promptThinking).toContain("export * from \"../ui/thinking-bar\"");
    expect(promptChain).toContain("export * from \"../ui/chain-of-thought\"");
    expect(promptShimmer).toContain("export * from \"../ui/text-shimmer\"");
    expect(agentThinking).toContain("@/components/prompt-kit/text-shimmer");
    expect(chatThinking).toContain("@/components/prompt-kit/text-shimmer");
    expect(chatThinking).toContain("@/components/prompt-kit/chain-of-thought");
    expect(chatThinking).toContain("state.isActive ? (");
    expect(chatThinking).toContain("<TextShimmer");
    expect(chatThinking).toContain("<ChainOfThought");
    expect(chatThinking).toContain("<ChainOfThoughtStep");
    expect(chatThinking).toContain("<ChainOfThoughtTrigger");
    expect(chatThinking).toContain("<ChainOfThoughtContent");
    expect(chatThinking).toContain("<ChainOfThoughtItem");
    expect(chatThinking).not.toContain("bg-oa-blue/5");
    expect(chatThinking).not.toContain("border-oa-blue");
    expect(chatThinking).not.toContain("shadow-sm");
    expect(chatThinking).not.toContain("Trusted local trace");
    expect(chatThinking).toContain("Private details masked");
    expect(chatThinking).not.toContain("bg-gradient-to-r");
    expect(agentThinking).not.toContain("StopCircle");
    expect(agentThinking).not.toContain("stopLabel");
    expect(agentThinking).not.toContain("bg-oa-blue/5");
    expect(agentThinking).not.toContain("border-oa-blue");
    expect(agentThinking).not.toContain("bg-gradient-to-r");
    expect(agentRun).not.toContain("onStop={onStop}");
    expect(typing).not.toContain("showStop={");
    expect(typing).not.toContain("onStop={onStop}");
    expect(approval).not.toContain("RedactionEditor");
    expect(consent).toContain("<RedactionEditor");
  });

  it("renders relay peer presence and incoming messages without false offline labels", () => {
    const header = read("ui/src/features/chat/ConversationHeader.tsx");
    const listItem = read("ui/src/features/chat/ConversationListItem.tsx");
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const timelineModel = read("ui/src/components/stream-like/timelineModel.ts");
    const hooks = read("ui/src/hooks/queries.ts");
    const mapper = read("ui/src/lib/normalizePeerPresence.ts");
    expect(header).toContain("normalizePeerPresence(conversation)");
    expect(listItem).toContain("normalizePeerPresence(conversation)");
    expect(mapper).toContain("Presence unavailable");
    expect(mapper).toContain("Old agent route - switch to current agent");
    expect(timelineModel).toContain("direction !== \"incoming\"");
    expect(bubble).toContain("humanMessage.sender_label");
    expect(bubble).toContain("showRetry={isOutgoingHuman && String(deliveryStatus).toLowerCase().includes(\"fail\")}");
    expect(hooks).toContain("queryKeys.contacts");
  });

  it("uses an Oracle Amigo user rail without raw agent rows", () => {
    const shell = read("ui/src/app/AppShell.tsx");
    const providers = read("ui/src/app/AppProviders.tsx");
    const rail = read("ui/src/app/UserRail.tsx");
    const profileDialog = read("ui/src/app/AccountProfileDialog.tsx");
    const model = read("ui/src/app/userRailModel.ts");
    expect(shell).toContain("<UserRail />");
    expect(providers).toContain("TooltipProvider");
    expect(providers).toContain('from "@/components/ui/tooltip"');
    expect(rail).toContain("oa-user-rail");
    expect(rail).toContain('from "@/components/ui/tooltip"');
    expect(rail).toContain("<Tooltip>");
    expect(rail).toContain("<TooltipTrigger asChild>");
    expect(rail).toContain('<TooltipContent side="right" sideOffset={10}');
    expect(rail).toContain("RailLabelTooltip");
    expect(rail).toContain("RailUserTooltip");
    expect(rail).toContain("detail={user.email ?? user.presence.label}");
    expect(rail).toContain("detail={cloudStatus?.cloud?.userEmail ?? presence.label}");
    expect(rail).not.toContain("title={label}");
    expect(rail).not.toContain("title={`${user.displayName} - ${user.presence.label}`}");
    expect(rail).toContain("Badge.Anchor");
    expect(rail).toContain("Search directory");
    expect(model).toContain("buildRailUsers");
    expect(model).toContain("safePersonName");
    expect(model).toContain("My local agent");
    expect(model).toContain("RAW_AGENT_RE");
    expect(model).toContain("directoryByAgentInstanceId");
    expect(model).toContain("peerUserIdForContact");
    expect(rail).toContain("Account profile:");
    expect(rail).toContain("Popover");
    expect(rail).toContain("PopoverTrigger");
    expect(rail).toContain("PopoverContent");
    expect(rail).not.toContain("DropdownMenu");
    expect(rail).not.toContain("open={popoverOpen ? false : undefined}");
    expect(rail).toContain("{!popoverOpen && (");
    expect(rail).toContain("AccountProfileDialog");
    expect(profileDialog).toContain("<ProfileDetails");
    expect(profileDialog).toContain("readSelectedImage");
    expect(profileDialog).toContain("BIO_MAX_LENGTH");
    expect(profileDialog).toContain("coverImage");
    expect(profileDialog).toContain("avatarImage");
    expect(profileDialog).toContain("Biography");
    expect(profileDialog).toContain("Save changes");
    expect(profileDialog).toContain("Cancel");
    expect(profileDialog).toContain("aria-label=\"Account profile dialog\"");
    expect(profileDialog).toContain("aria-label=\"Upload profile cover image\"");
    expect(profileDialog).toContain("aria-label=\"Upload profile avatar image\"");
    expect(profileDialog).not.toContain("Website");
    expect(profileDialog).not.toContain("website");
    expect(profileDialog).not.toContain("First name");
    expect(profileDialog).not.toContain("Last name");
    expect(profileDialog).not.toContain("Username");
    expect(rail).toContain("oa-account-popover-header");
    expect(rail).toContain("oa-account-popover-avatar");
    expect(rail).toContain("oa-account-popover-body");
    expect(rail).toContain("oa-account-popover-footer");
    expect(rail).toContain("oa-account-popover-signout");
    expect(rail).toContain("accountDetail");
    expect(rail).toContain("w-[15.5rem]");
    expect(rail).toContain("id=\"profile\"");
    expect(rail).toContain("id=\"settings\"");
    expect(rail).toContain("id=\"logout\"");
    expect(rail).not.toContain("id=\"agents\"");
    expect(rail).not.toContain("id=\"approvals\"");
    expect(rail).not.toContain("id=\"files\"");
    expect(rail).not.toContain("id=\"tasks\"");
    expect(rail).not.toContain("id=\"audit\"");
    for (const [before, after] of [
      ["profile", "settings"],
      ["settings", "logout"],
    ] as const) {
      expect(rail.indexOf(`id="${before}"`)).toBeLessThan(rail.indexOf(`id="${after}"`));
    }
    expect(rail).toContain("onOpenProfile");
    expect(rail.indexOf("<AccountProfileDialog")).toBeLessThan(rail.indexOf("function RailProfileButton"));
    expect(rail).toContain("navigate(\"/settings\")");
    expect(rail).not.toContain("closeAndNavigate");
    expect(profileDialog).toContain("<DialogContent");
    expect(profileDialog).toContain("<DialogTitle");
    expect(profileDialog).toContain("<DialogDescription");
    expect(profileDialog).toContain("className=\"oa-profile-dialog p-0\"");
    const styles = read("ui/src/styles.css");
    expect(styles).toContain(".oa-profile-dialog");
    expect(styles).toContain("left: 50% !important");
    expect(styles).toContain("top: 50% !important");
    expect(styles).toContain("transform: translate(-50%, -50%) !important");
    expect(styles).toContain("[data-slot=\"dialog-overlay\"]");
    expect(styles).toContain("z-index: 130 !important");
    expect(rail).not.toContain("label=\"Settings\"");
    expect(rail).toContain("navigate(\"/chats/local-agent\")");
    expect(rail).toContain("peer_agent_instance_id");
    expect(model).toContain("agent:${conversation.agentInstanceId}");
  });

  it("uses focused conversation data so routed chats are not hidden by stale lists", () => {
    const main = read("ui/src/features/chat/MainChatLayout.tsx");
    const types = read("ui/src/types.ts");
    const server = read("src/server.ts");
    expect(types).toContain("conversation?: Conversation");
    expect(main).toContain("messagesData?.conversation");
    expect(main).toContain("messagesIsError");
    expect(main).toContain("<ChatCanvasErrorState");
    expect(main).not.toContain("navigate(`/chats/${localConversationId ?? \"local-agent\"}`");
    expect(main).not.toContain("const localConversationId");
    expect(main).toContain('onOpenLocalAgent={isMissingConversation ? () => navigate("/chats/local-agent", { replace: true }) : undefined}');
    expect(server).toContain("conversation: conversationToUi");
    expect(server).toContain("getOrCreateLocalConversation");
  });

  it("wires reply actions to the persistent thread drawer", () => {
    const main = read("ui/src/features/chat/MainChatLayout.tsx");
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const drawer = read("ui/src/components/stream-like/ThreadDrawer.tsx");
    const threadStore = read("ui/src/lib/messageThreads.ts");
    const hooks = read("ui/src/hooks/queries.ts");
    const api = read("ui/src/api/chatApi.ts");
    const server = read("src/server.ts");
    expect(main).toContain("oa-reply-to-message");
    expect(main).toContain("oa-open-thread");
    expect(main).toContain("<ThreadDrawer");
    expect(main).toContain("useCreateThreadReply");
    expect(bubble).toContain("Reply in thread");
    expect(bubble).toContain("ReplyPreviewCard");
    expect(bubble).toContain("oa-jump-to-message");
    expect(bubble).toContain("ThreadSummaryPill");
    expect(bubble).toContain("usePinMessage");
    expect(bubble).not.toContain("const [pinned, setPinned]");
    expect(threadStore).toContain("oa-message-threads-v1");
    expect(drawer).toContain("useMessageThread(subject?.messageId)");
    expect(hooks).toContain("useLoadAroundMessage");
    expect(hooks).toContain("useThread");
    expect(hooks).toContain("usePinMessage");
    expect(api).toContain("around");
    expect(api).toContain("pinMessage");
    expect(api).toContain("createThreadReply");
    expect(server).toContain("\"/chat/conversations/:conversationId/messages/:messageId/pin\"");
    expect(server).toContain("\"/chat/conversations/:conversationId/threads/:threadId\"");
    expect(server).toContain("reply_preview");
    expect(server).toContain("thread_summary");
    expect(server).toContain("MESSAGE_NOT_FOUND");
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
    const bubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    expect(transfer).toContain("<DocumentPreviewCard");
    expect(transfer).toContain("Copy hash");
    expect(transfer).toContain("View in Files");
    expect(transfer).toContain("copyHash");
    expect(transfer).not.toContain("/download");
    expect(bubble).toContain("isCompletedTransferMessage");
    expect(bubble).toContain("[\"stored\", \"available\"].includes");
  });

  it("protects app routes by cloud enrollment status", () => {
    const routes = read("ui/src/app/routes.tsx");
    const routeShell = read("ui/src/app/RouteShell.tsx");
    const enrollment = read("ui/src/features/enrollment/DeviceEnrollmentScreen.tsx");
    const auth = read("ui/src/features/auth/AuthScreen.tsx");
    const nav = read("ui/src/features/auth/AuthShellNav.tsx");
    expect(routes).toContain("function RouteGate()");
    expect(routes).toContain("useLocalUiSession");
    expect(routes).toContain("useCloudUserSession");
    expect(routes).toContain("isCloudUserSessionReady");
    expect(routes).toContain("localSession.status === \"blocked\"");
    expect(routes).toContain("cloudSession.status === \"blocked\"");
    expect(routes).toContain("Refreshing local UI session");
    expect(routes).toContain("<Route element={<RouteShell />}>");
    expect(routes).toContain("status === \"disconnected\"");
    expect(routes).toContain("to=\"/login\"");
    expect(routes).toContain("status !== \"enrolled\"");
    expect(routes).toContain("hasDeviceAccessToken");
    expect(routes).toContain("hasUserAccessToken");
    expect(routes).toContain("userAuthIssue");
    expect(routes).toContain("data?.tokenIssue !== \"expired\"");
    expect(routes).toContain("const cloudAuthMessage =");
    expect(routes).toContain("Cloud login expired. Please sign in again.");
    expect(routes).toContain("Please sign in to continue.");
    expect(routes).toContain("to=\"/enroll\"");
    expect(routes).toContain("<Route element={<RouteGate />}>");
    expect(auth).toContain("routeState?.cloudAuthMessage");
    expect(auth).toContain("resetCloudUserSession()");
    expect(auth).toContain("markCloudUserReady()");
    expect(routeShell).toContain("overflow-y-auto");
    expect(routeShell).toContain("data-testid=\"auth-route-scroll\"");
    expect(enrollment).toContain("<AuthDotMatrixBackground />");
    expect(enrollment).toContain("<MiniNavbar showLogout />");
    expect(enrollment).toContain("oa-enroll-submit");
    expect(enrollment).toContain("api.enroll");
    expect(enrollment).toContain("api.cloudStatus");
    expect(enrollment).toContain("queryKeys.cloudStatus");
    expect(enrollment).toContain("navigate(\"/inbox\"");
    expect(enrollment).toContain("ENROLLMENT_CAPABILITIES");
    expect(enrollment).not.toContain("<CapabilitiesReview");
    expect(enrollment).not.toContain("Agent Capabilities");
    expect(enrollment).not.toContain("A2A v1.0");
    expect(enrollment).not.toContain("File Search");
    expect(enrollment).not.toContain("File Transfer (Send)");
    expect(enrollment).not.toContain("File Transfer (Receive)");
    expect(enrollment).not.toContain("Approval Workflow");
    expect(nav).toContain("showLogout");
    expect(nav).toContain("oa-auth-nav-logout");
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
    const shell = read("ui/src/app/AppShell.tsx");
    const button = read("ui/src/features/auth/LogoutButton.tsx");
    const service = read("src/enrollment/DeviceEnrollmentService.ts");
    expect(api).toContain("request<{ ok: boolean; remoteRevoked: boolean }>(\"/cloud/logout\", { method: \"POST\" })");
    expect(hooks).toContain("export function useLogout()");
    expect(hooks).toContain("logoutProtectedQueryRoots");
    expect(hooks).toContain("queryClient.setQueryData<CloudStatus | undefined>(queryKeys.cloudStatus, disconnectedCloudStatus)");
    expect(button).toContain("aria-label=\"Log out\"");
    expect(button).toContain("navigate(\"/login\"");
    expect(shell).not.toContain("NavBar");
    expect(nav).not.toContain("<LogoutButton />");
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
    expect(chatWindow).toContain("clientMessageId: crypto.randomUUID()");
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
    expect(html).not.toContain('name="theme-color"');
  });

  it("keeps browser compatibility warnings out of authored UI chrome styles", () => {
    const styles = read("ui/src/styles.css");

    expect(styles).not.toContain("text-wrap: balance");
    expect(styles).not.toContain("scrollbar-width: none");
    expect(styles).not.toContain("text-size-adjust");
    expect(styles).toContain(".oa-user-rail::-webkit-scrollbar");
  });
});
