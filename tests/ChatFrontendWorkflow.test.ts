import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("agentic chat frontend workflow contract", () => {
  it("exposes auth, enrollment, directory, chat, approval, transfer, and diagnostics surfaces", () => {
    const app = read("ui/src/App.tsx");
    for (const expected of [
      "Authentication mode",
      "Device enrollment",
      "Contacts and conversations",
      "Messaging workspace",
      "Approval Center",
      "Files",
      "Audit",
      "Diagnostics",
      "Command palette",
      "File request",
      "Hash verified",
      "waiting for connection",
      "Retry",
      "defaultOrgSlug",
      "local-dev",
      "auth-runtime"
    ]) {
      expect(app).toContain(expected);
    }
  });

  it("detects file-like messages and sends them as relay file requests", () => {
    const app = read("ui/src/App.tsx");
    const relay = read("ui/src/api/relayApi.ts");
    const chat = read("ui/src/api/chatApi.ts");
    expect(app).toContain("isFileRequest");
    expect(app).toContain("send_as: looksLikeFileRequest ? \"file_request\" : \"normal\"");
    expect(relay).toContain("/relay/send-file-request");
    expect(chat).toContain("/chat/conversations");
  });

  it("uses TanStack Query optimistic mutations and polling transport hooks", () => {
    const hooks = read("ui/src/hooks/queries.ts");
    const transport = read("ui/src/realtime/RealtimeTransport.ts");
    for (const expected of [
      "onMutate",
      "local_pending",
      "decision_pending",
      "invalidateQueries",
      "useSendMessage",
      "useSendFileRequest",
      "useApproveFileRequest",
      "useRejectFileRequest",
      "useSubmitApprovalFeedback",
      "useRealtimePolling"
    ]) {
      expect(hooks).toContain(expected);
    }
    expect(transport).toContain("PollingTransport");
    expect(transport).toContain("RealtimeTransport");
    expect(transport).not.toContain("new WebSocket");
  });

  it("keeps accessibility landmarks for chat timeline, composer, and approval actions", () => {
    const app = read("ui/src/App.tsx");
    const components = read("ui/src/components/index.tsx");
    expect(app).toContain("aria-label=\"Oracle Amigo agentic chat application\"");
    expect(app).toContain("aria-label=\"Message composer\"");
    expect(app).toContain("aria-label=\"Connection status\"");
    expect(app).toContain("role=\"alert\"");
    expect(components).toContain("role=\"log\"");
    expect(components).toContain("aria-live=\"polite\"");
  });

  it("defines the expected typed API modules and shared message types", () => {
    const apiTypes = read("ui/src/api/types.ts");
    const rootTypes = read("ui/src/types.ts");
    for (const file of [
      "ui/src/api/localAgentClient.ts",
      "ui/src/api/cloudAuthApi.ts",
      "ui/src/api/cloudDirectoryApi.ts",
      "ui/src/api/chatApi.ts",
      "ui/src/api/relayApi.ts",
      "ui/src/api/approvalsApi.ts",
      "ui/src/api/filesApi.ts",
      "ui/src/api/auditApi.ts"
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
