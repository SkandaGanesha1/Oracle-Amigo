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
      expect(init?.credentials).toBe("same-origin");
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
    expect(localAgentClient).toContain("credentials: \"same-origin\"");
    expect(sharedMessage).toContain("safeMediaSrc(src)");
    expect(sharedMessage).not.toContain("<AvatarImage src={src}");
    expect(intentChip).toContain("previewUrlRef");
    expect(intentChip).toContain("URL.revokeObjectURL(previewUrlRef.current)");
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
    expect(bubble).toContain("<TransferProgressCard");
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
    expect(chat).toContain("setPendingSend({ text, sendAs })");
  });

  it("keeps chat polling stable with structural message sharing", () => {
    const hooks = read("ui/src/hooks/queries.ts");
    expect(hooks).toContain("function shallowEqualRecord");
    expect(hooks).toContain("function structurallyShareMessages");
    expect(hooks).toContain("structuralSharing: structurallyShareMessages");
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
    expect(actionCenter).not.toContain("Intent-first inbox");
    expect(inboxApi).toContain("/api/inbox/items");
    expect(hooks).toContain("export function useInboxItemAction");
    expect(empty).toContain("All clear");
    expect(detail).toContain("Masked by privacy mode");
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
    const store = read("ui/src/lib/messageReactions.ts");
    const actions = read("ui/src/components/stream-like/MessageActions.tsx");
    expect(store).toContain("oa-message-reactions-v1");
    expect(store).toContain("useSyncExternalStore");
    expect(actions).toContain("useMessageReactions(messageId)");
    expect(actions).toContain("toggleReaction(\"like\")");
    expect(actions).toContain("oa-message-hover-toolbar");
    expect(actions).toContain("DropdownMenu.Content");
    expect(actions).not.toContain("min-h-[48px]");
  });

  it("uses compact chat header, composer, and document preview cards", () => {
    const header = read("ui/src/features/chat/ConversationHeader.tsx");
    const composer = read("ui/src/components/stream-like/MessageComposer.tsx");
    const docCard = read("ui/src/components/stream-like/DocumentPreviewCard.tsx");
    const fileRequest = read("ui/src/components/agentic-ai/FileRequestMessage.tsx");
    const approval = read("ui/src/components/agentic-ai/ApprovalCardMessage.tsx");
    const transfer = read("ui/src/components/agentic-ai/TransferProgressMessage.tsx");
    const receipt = read("ui/src/components/agentic-ai/FileReceiptMessage.tsx");
    const styles = read("ui/src/styles.css");
    expect(header).toContain("oa-chat-header");
    expect(header).toContain("oa-chat-header-identity");
    expect(header).toContain("oa-rail-avatar-anchor");
    expect(header).toContain("oa-rail-avatar h-10 w-10 rounded-full");
    expect(header).toContain("oa-rail-presence-badge");
    expect(header).toContain("local ? \"MY\" : initialsFor(displayTitle)");
    expect(header).not.toContain("oa-chat-header-toolbar");
    expect(header).not.toContain("oa-chat-header-search");
    expect(header).not.toContain("oa-open-chat-search");
    expect(header).not.toContain("presence.label");
    expect(header).not.toContain("Phone");
    expect(header).not.toContain("Video");
    expect(header).not.toContain("UserPlus");
    expect(header).not.toContain("Members");
    expect(header).not.toContain("Notifications");
    expect(header).not.toContain("Voice input");
    expect(composer).toContain("oa-composer-dock");
    expect(composer).toContain("oa-composer-frame");
    expect(composer).toContain("oa-composer-send");
    expect(composer).not.toContain("HuddleButton");
    expect(composer).not.toContain("Start huddle");
    expect(composer).not.toContain("Voice input");
    expect(docCard).toContain("export interface ChatDocumentPreview");
    expect(fileRequest).toContain("oa-agent-card compact");
    expect(approval).toContain("<DocumentPreviewCard");
    expect(transfer).toContain("<DocumentPreviewCard");
    expect(receipt).toContain("<DocumentPreviewCard");
    expect(styles).toContain(".oa-doc-card");
    expect(styles).toContain(".oa-message-hover-toolbar");
    expect(styles).toContain(".oa-composer-dock");
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
    expect(rail).toContain("Dropdown");
    expect(rail).toContain("Drawer");
    expect(rail).toContain("AccountProfileDrawer");
    expect(rail).toContain("<ProfileDetails");
    expect(rail).toContain("id=\"profile\"");
    expect(rail).toContain("id=\"agents\"");
    expect(rail).toContain("id=\"approvals\"");
    expect(rail).toContain("id=\"files\"");
    expect(rail).toContain("id=\"tasks\"");
    expect(rail).toContain("id=\"audit\"");
    expect(rail).toContain("id=\"settings\"");
    expect(rail).toContain("id=\"logout\"");
    for (const [before, after] of [
      ["profile", "agents"],
      ["agents", "approvals"],
      ["approvals", "files"],
      ["files", "tasks"],
      ["tasks", "audit"],
      ["audit", "settings"],
      ["settings", "logout"],
    ] as const) {
      expect(rail.indexOf(`id="${before}"`)).toBeLessThan(rail.indexOf(`id="${after}"`));
    }
    expect(rail).toContain("onOpenProfile");
    expect(rail.indexOf("<AccountProfileDrawer")).toBeLessThan(rail.indexOf("function RailProfileButton"));
    expect(rail).toContain("navigate(\"/agents\")");
    expect(rail).toContain("navigate(\"/approvals\")");
    expect(rail).toContain("navigate(\"/files\")");
    expect(rail).toContain("navigate(\"/tasks\")");
    expect(rail).toContain("navigate(\"/audit\")");
    expect(rail).toContain("placement=\"right\"");
    expect(rail).toContain("aria-label=\"Account profile drawer\"");
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
    expect(main).toContain("<ConversationLoadErrorPanel");
    expect(main).not.toContain("navigate(`/chats/${localConversationId ?? \"local-agent\"}`");
    expect(main).not.toContain("const localConversationId");
    expect(main).toContain('onOpenLocalAgent={() => navigate("/chats/local-agent", { replace: true })}');
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
    expect(transfer).toContain("<DocumentPreviewCard");
    expect(transfer).toContain("Copy hash");
    expect(transfer).toContain("View in Files");
    expect(transfer).toContain("copyHash");
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
  });
});
