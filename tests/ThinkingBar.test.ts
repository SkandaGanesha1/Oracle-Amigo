import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("continuous thinking bar chat contract", () => {
  it("collapses agent status messages into a single thinking bar timeline item", () => {
    const chatWindow = read("ui/src/features/chat/ChatWindow.tsx");
    const messageBubble = read("ui/src/components/stream-like/MessageBubble.tsx");
    const thinkingBar = read("ui/src/components/chat/ThinkingBar.tsx");
    const types = read("ui/src/types.ts");

    expect(types).toContain("ThinkingBarMessage");
    expect(types).toContain('kind: "thinking_bar"');
    expect(chatWindow).toContain("collapseAgentStatusMessages");
    expect(chatWindow).toContain("statusGroupKey");
    expect(chatWindow).toContain("humanizeAgentStatus");
    expect(chatWindow).toContain("technicalTrace");
    expect(messageBubble).toContain('message.kind === "thinking_bar"');
    expect(messageBubble).toContain("<ThinkingBar state={message.state} privacyMasked />");
    expect(thinkingBar).toContain("Continuous agent thinking");
    expect(thinkingBar).toContain("Private details masked");
  });

  it("keeps raw technical traces behind disclosure instead of primary timeline text", () => {
    const chatWindow = read("ui/src/features/chat/ChatWindow.tsx");
    const thinkingBar = read("ui/src/components/chat/ThinkingBar.tsx");

    expect(chatWindow).toContain("Searching relevant local context");
    expect(chatWindow).toContain("Checking the local evidence and access boundary");
    expect(chatWindow).toContain("Preparing a user-facing answer");
    expect(thinkingBar).toContain("aria-expanded");
    expect(thinkingBar).toContain("maskTrace");
    expect(thinkingBar).toContain("Local path hidden");
    expect(thinkingBar).toContain("[secret redacted]");
  });
});
