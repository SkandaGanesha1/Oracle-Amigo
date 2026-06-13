import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("frontend interaction inventory", () => {
  it("keeps chat received-file actions backed by explicit routes", () => {
    const app = read("ui/src/components/StreamLikeChat.tsx");
    const filesApi = read("ui/src/api/filesApi.ts");
    const server = read("src/server.ts");

    expect(app).toContain("/storage/files/${encodeURIComponent(file.id)}/open");
    expect(app).toContain("/storage/files/${encodeURIComponent(file.id)}/download");
    expect(app).toContain("api.verifyFile(file.id)");
    expect(app).not.toContain("<button type=\"button\"><FolderOpen /> Show</button>");
    expect(filesApi).toContain("/storage/files/${encodeURIComponent(fileId)}/verify");
    expect(server).toContain("/storage/files/:id/verify");
  });

  it("does not leave known chat buttons enabled without behavior", () => {
    const app = read("ui/src/components/StreamLikeChat.tsx");

    expect(app).toContain("onClick={() => void onRetryMessage(message)}");
    expect(app).toContain("onChange={(event) => props.onSearchDirectory(event.currentTarget.value)}");
    expect(app).toContain("onStartConversation(user, primaryAgent)");
    expect(app).toContain("Direct attachment is not enabled");
    expect(app).toContain("is-disabled");
    expect(app).toContain("aria-label=\"Direct attachment is not enabled");
    expect(app).toContain("<Paperclip aria-hidden=\"true\" />");
    expect(app).not.toContain("<button type=\"button\" className=\"icon-button\" title=\"Attach file\"><Paperclip /></button>");
    expect(app).not.toContain("<button type=\"button\">Verify hash</button>");
  });

  it("keeps settings policy rows read-only until a settings API exists", () => {
    const app = read("ui/src/components/StreamLikeChat.tsx");

    expect(app).toContain("Configured safety policy");
    expect(app).toContain("Approval before file transfer");
    expect(app).not.toContain("<input type=\"checkbox\" defaultChecked /> Require approval before file transfer");
    expect(app).not.toContain("Enable experimental E2E encryption</label>");
  });

  it("admin refresh invalidates the admin query family instead of dispatching an unhandled event", () => {
    const header = read("ui-admin/src/portal/layout/Header.tsx");

    expect(header).toContain("useQueryClient");
    expect(header).toContain("queryClient.invalidateQueries({ queryKey: [\"admin\"] })");
    expect(header).not.toContain("oracle-amigo.admin.refresh-all");
  });

  it("does not import the duplicate legacy shared chat panel into production SPAs", () => {
    const chatApp = read("ui/src/App.tsx");
    const adminApp = read("ui-admin/src/portal/PortalApp.tsx");
    const sharedPanel = read("components/ui/agent-chat-panel.tsx");

    expect(chatApp).not.toContain("AgentChatPanel");
    expect(adminApp).not.toContain("AgentChatPanel");
    expect(sharedPanel).toContain("export const AgentChatPanel");
  });
});
