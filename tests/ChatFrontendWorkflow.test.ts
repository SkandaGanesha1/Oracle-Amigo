import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("custom stream-like chat frontend contract", () => {
  it("renders a custom Stream-like chat surface without Stream SDK packages", () => {
    const app = read("ui/src/App.tsx");
    const chat = read("ui/src/components/StreamLikeChat.tsx");
    const pkg = read("package.json");

    for (const expected of [
      "StreamLikeChatApp",
      "ChannelList",
      "ChannelWindow",
      "MessageList",
      "MessageComposer",
      "ThreadPanel",
      "DirectorySearchPanel",
      "CommandStatusBar",
      "Loader",
      "Custom Stream-like agentic chat",
      "Channel list",
      "Message composer",
      "Right inspector panel"
    ]) {
      expect(`${app}\n${chat}`).toContain(expected);
    }

    expect(pkg).not.toContain("\"stream-chat\"");
    expect(pkg).not.toContain("\"stream-chat-react\"");
    expect(chat).not.toContain("stream-chat-react");
  });

  it("uses prompt-kit loader variants for function-specific loading states", () => {
    const chat = read("ui/src/components/StreamLikeChat.tsx");
    for (const expected of [
      "variant=\"classic\"",
      "variant=\"circular\"",
      "variant=\"loading-dots\"",
      "variant=\"typing\"",
      "variant=\"text-shimmer\"",
      "variant=\"bars\"",
      "variant=\"terminal\"",
      "variant=\"pulse\"",
      "ChainOfThought",
      "BackendTraceChain",
      "FileResultCard",
      "backend-terminal",
      "file-result-card",
      "Processing request",
      "backendTraceForMessage",
      "isBackendTraceMessage",
      "messageActivityLoader"
    ]) {
      expect(chat).toContain(expected);
    }
    expect(chat).not.toContain("Loader2");
  });

  it("groups backend run trace and stops terminal loaders on final file states", () => {
    const chat = read("ui/src/components/StreamLikeChat.tsx");
    const styles = read("ui/src/styles.css");
    const types = read("ui/src/types.ts");

    for (const expected of [
      "visibleMessages",
      "!isBackendTraceMessage(message)",
      "traceMessages={backendTraceForMessage(message, props.messages)}",
      "Processed request",
      "Searching local files",
      "Preparing result",
      "formatDuration",
      "variant=\"terminal\"",
      "\"not_found\"",
      "\"approval_pending\"",
      "\"input_required\""
    ]) {
      expect(chat).toContain(expected);
    }

    expect(types).toContain("details?: Record<string, unknown>;");
  });

  it("uses existing chat APIs and preserves file-request routing", () => {
    const chat = read("ui/src/components/StreamLikeChat.tsx");
    const api = read("ui/src/api/client.ts");
    const chatApi = read("ui/src/api/chatApi.ts");
    const viteConfig = read("vite.config.ts");

    for (const expected of [
      "api.conversations()",
      "api.conversationMessages(conversationId)",
      "api.directoryUsers(query)",
      "api.createConversation({",
      "api.sendChatMessage(conversationId",
      "api.agentRunEventsUrl(runId)",
      "EventSource",
      "subscribeToAgentRun",
      "chatDiagnostics",
      "isFileRequest",
      "send_as: looksLikeFileRequest ? \"file_request\" : \"normal\"",
      "local_pending",
      "failed",
      "Retry"
    ]) {
      expect(chat).toContain(expected);
    }

    expect(api).toContain("sendChatMessage");
    expect(api).toContain("directoryUsers");
    expect(api).toContain("createConversation");
    expect(api).toContain("agentRunEventsUrl");
    expect(chatApi).toContain("/chat/conversations");
    expect(chatApi).toContain("/agent/runs");
    expect(chatApi).toContain("/chat/diagnostics");
    expect(viteConfig).toContain("\"/agent\": localAgentTarget");
    expect(chat).toContain("older chat API");
  });

  it("surfaces relay health separately from local chat availability", () => {
    const chat = read("ui/src/components/StreamLikeChat.tsx");
    const api = read("ui/src/api/client.ts");
    const localClient = read("ui/src/api/localAgentClient.ts");

    for (const expected of [
      "loadRelayDiagnostics",
      "api.health()",
      "api.cloudStatus()",
      "api.relayInboxStatus()",
      "relayIssueFor",
      "RelayHealthBanner",
      "Reconnect cloud session",
      "Refresh relay status",
      "Use local agent",
      "Control plane unreachable",
      "Control plane mismatch",
      "cloudStatus.controlPlane?.status",
      "CloudConnectForm",
      "Connect and enroll",
      "Connection status",
      "Relay polling",
      "Heartbeat",
      "api.signup",
      "api.login",
      "api.enroll",
      "conversation.agentInstanceId",
      "relay_unavailable"
    ]) {
      expect(chat).toContain(expected);
    }
    expect(api).toContain("relayInboxStatus");
    expect(localClient).toContain("ApiRequestError");
  });

  it("keeps accessible chat landmarks and live message updates", () => {
    const chat = read("ui/src/components/StreamLikeChat.tsx");

    for (const expected of [
      "aria-label=\"Custom Stream-like agentic chat\"",
      "aria-label=\"Channel list\"",
      "aria-label={props.conversation ? `Conversation with ${props.conversation.title}`",
      "aria-label=\"Message composer\"",
      "role=\"log\"",
      "aria-live=\"polite\"",
      "role=\"alert\""
    ]) {
      expect(chat).toContain(expected);
    }
  });

  it("defines the expected typed API modules and shared message types", () => {
    const apiTypes = read("ui/src/api/types.ts");
    const rootTypes = read("ui/src/types.ts");
    for (const file of [
      "ui/src/api/localAgentClient.ts",
      "ui/src/api/chatApi.ts",
      "ui/src/api/relayApi.ts",
      "ui/src/api/approvalsApi.ts",
      "ui/src/api/filesApi.ts",
      "ui/src/api/auditApi.ts",
      "ui/src/api/registryApi.ts",
      "ui/src/api/skillsApi.ts",
      "ui/src/api/fileIndexApi.ts",
      "ui/src/api/tasksApi.ts",
      "ui/src/api/memoryApi.ts",
      "ui/src/api/intentApi.ts",
      "ui/src/api/policyApi.ts"
    ]) {
      expect(read(file).length).toBeGreaterThan(20);
    }
    for (const expected of [
      "HumanChatMessage",
      "AgentStatusMessage",
      "SystemEventMessage",
      "FileRequestMessage",
      "FileCandidateApprovalCard",
      "TransferProgressMessage",
      "FileReceiptMessage",
      "A2ATaskMessage"
    ]) {
      expect(`${apiTypes}\n${rootTypes}`).toContain(expected);
    }
  });
});
