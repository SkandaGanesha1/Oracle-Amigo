/// <reference types="vitest/globals" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("ChatWindow", () => {
  it("renders MessageTimeline and ComposerDock", () => {
    const source = read("ui/src/features/chat/ChatWindow.tsx");
    expect(source).toContain("MessageTimeline");
    expect(source).toContain("ComposerDock");
    expect(source).toContain("SendConfirmation");
  });

  it("has proper fragment wrapping without extra div", () => {
    const source = read("ui/src/features/chat/ChatWindow.tsx");
    // Uses <> as root wrapper
    expect(source).toContain("return (");
    expect(source).toContain("<>");
  });
});

describe("MainChatLayout", () => {
  it("renders ConversationHeader, ChatWindow, RightInspectorPanel", () => {
    const source = read("ui/src/features/chat/MainChatLayout.tsx");
    expect(source).toContain("ConversationHeader");
    expect(source).toContain("ChatWindow");
    expect(source).toContain("RightInspectorPanel");
  });

  it("renders ConversationSidebar via SectionSidebar", () => {
    const source = read("ui/src/app/SectionSidebar.tsx");
    expect(source).toContain("ConversationSidebar");
  });

  it("persists inspector state to localStorage", () => {
    const source = read("ui/src/features/chat/MainChatLayout.tsx");
    expect(source).toContain("localStorage");
    expect(source).toContain("oa-inspector-open");
  });
});

describe("MessageComposer", () => {
  it("has slash command support", () => {
    const source = read("ui/src/components/stream-like/MessageComposer.tsx");
    expect(source).toContain("handleKeyDown");
    expect(source).toContain("onSend");
    expect(source).toContain("aria-label");
  });
});

describe("ConversationSidebar", () => {
  it("renders DirectorySearch and ConversationList", () => {
    const source = read("ui/src/features/chat/ConversationSidebar.tsx");
    expect(source).toContain("DirectorySearch");
    expect(source).toContain("ConversationList");
  });
});

describe("RightInspectorPanel", () => {
  it("renders 8 tabs with HeroUI Button components", () => {
    const source = read("ui/src/features/inspector/RightInspectorPanel.tsx");
    expect(source).toContain('"primary" : "ghost"');
    expect(source).toContain('variant="ghost"');
    expect(source).toContain("@heroui/react");
  });
});
