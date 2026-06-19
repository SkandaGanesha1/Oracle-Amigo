/// <reference types="vitest/globals" />
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationHeader } from "../features/chat/ConversationHeader";
import { MessageComposer } from "../components/stream-like/MessageComposer";
import { mapApproval } from "../api/client";
import type { Conversation } from "../api/types";

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "local-agent",
    title: "My local agent",
    subtitle: "This device",
    peerUserId: null,
    agentInstanceId: "agi-local",
    presence: "online",
    unread: 2,
    lastMessage: "Ready",
    pendingApprovals: 1,
    transferCount: 1,
    messages: [],
    readState: { conversationId: "local-agent", lastReadMessageId: "msg-1", unreadCount: 2, mentionCount: 0 },
    ...overrides,
  };
}

describe("advanced chat redesign", () => {
  it("renders the conversation command bar and toggles the inspector", async () => {
    const user = userEvent.setup();
    const onToggleInspector = vi.fn();
    render(
      <ConversationHeader
        conversation={makeConversation()}
        onToggleInspector={onToggleInspector}
        inspectorOpen={false}
      />
    );

    expect(screen.getByText("My local agent")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search My local agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open pinned messages" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open inspector" }));
    expect(onToggleInspector).toHaveBeenCalledTimes(1);
  });

  it("switches composer intent into the approval-safe file request flow", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageComposer conversationId="local-agent" onSend={onSend} />);

    await user.click(screen.getByRole("button", { name: "Start file request" }));
    const textbox = screen.getByRole("textbox");
    expect(textbox).toHaveValue("/request-file ");
    expect(screen.getByText("Send file request? The agent must ask before any file leaves this device.")).toBeInTheDocument();

    await user.type(textbox, "NonPO invoice india.pdf file");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("/request-file NonPO invoice india.pdf file", "file_request");
  });

  it("preserves bound approval state from pending approval payloads", () => {
    const card = mapApproval({
      id: "approval-1",
      task_id: "task-1",
      request_text: "Please send release-checklist.pdf",
      status: "pending",
      selected_file_id: "candidate-1",
      bound_file_path: "C:\\Users\\Alice\\Documents\\release-checklist.pdf",
      is_bound: true,
      candidates: [{
        candidate_id: "candidate-1",
        file_name: "release-checklist.pdf",
        display_path: "Local path hidden from recipient",
        size_bytes: 2048,
        match_score: 0.98,
      }],
    });

    expect(card.selected_candidate_id).toBe("candidate-1");
    expect(card.is_bound).toBe(true);
  });
});
