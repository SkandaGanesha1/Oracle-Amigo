/// <reference types="vitest/globals" />
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConversationHeader } from "../features/chat/ConversationHeader";
import { MessageComposer } from "../components/stream-like/MessageComposer";
import { ApprovalCardMessage } from "../components/agentic-ai/ApprovalCardMessage";
import { MessageBubble } from "../components/stream-like/MessageBubble";
import { isHiddenTimelineMessage } from "../components/stream-like/VirtualizedMessageList";
import { mapApproval } from "../api/client";
import type { Conversation, FileCandidateApprovalMessage, TransferProgressMessage } from "../api/types";

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

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeApprovalMessage(overrides: Partial<FileCandidateApprovalMessage["card"]> = {}): FileCandidateApprovalMessage {
  return {
    kind: "approval",
    id: "approval-message-1",
    created_at: new Date(0).toISOString(),
    card: {
      approval_id: "approval-1",
      task_id: "task-1",
      requester: "agi_remote",
      request_text: "Please send NonPO invoice india.pdf",
      candidates: [
        {
          candidate_id: "candidate-1",
          file_name: "NonPO_Invoice_India.pdf",
          display_path: "Local path hidden from recipient",
          extension: ".pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          modified_at: new Date(0).toISOString(),
          match_score: 0.7,
          match_reason: "Filename match",
          preview_url: "/storage/files/candidate-1/open",
          safety_labels: ["Approval required"],
        },
        {
          candidate_id: "candidate-2",
          file_name: "Harassment Certification.pdf",
          display_path: "Local path hidden from recipient",
          extension: ".pdf",
          mime_type: "application/pdf",
          size_bytes: 4096,
          modified_at: new Date(0).toISOString(),
          match_score: 0.7,
          match_reason: "Filename match",
          preview_url: "/storage/files/candidate-2/open",
          safety_labels: ["Approval required"],
        },
      ],
      selected_candidate_id: "candidate-1",
      status: "pending",
      feedback_text: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
  };
}

function makeTransferMessage(overrides: Partial<TransferProgressMessage> = {}): TransferProgressMessage {
  return {
    kind: "transfer",
    id: "transfer-message-1",
    transfer_id: "transfer-1",
    task_id: "task-1",
    file_name: "Harassment Certification.pdf",
    size_bytes: 58_600,
    sha256: "909acc5ae29909acc5ae29909acc5ae29909acc5ae29909acc5ae29909acc5ae2",
    progress_percent: 100,
    status: "stored",
    created_at: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("advanced chat redesign", () => {
  it("renders a focused conversation header with identity, search, and a title profile card", async () => {
    const user = userEvent.setup();
    render(<ConversationHeader conversation={makeConversation()} />);

    expect(screen.getByText("My local agent")).toBeInTheDocument();
    const profileTrigger = screen.getByRole("button", { name: "Open My local agent profile card" });
    expect(profileTrigger).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search My local agent" })).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
    expect(screen.queryByText("1 approval")).not.toBeInTheDocument();
    expect(screen.queryByText("1 transfer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open pinned messages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open inspector" })).not.toBeInTheDocument();

    await user.click(profileTrigger);

    expect(screen.getByRole("dialog", { name: "My local agent profile card" })).toBeInTheDocument();
    expect(screen.getAllByText("My local agent").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("This device").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Online")).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/local time$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Links" })).toBeInTheDocument();
    expect(screen.queryByText("Follow")).not.toBeInTheDocument();
    expect(screen.queryByText("Following")).not.toBeInTheDocument();
    expect(screen.queryByText("Likes")).not.toBeInTheDocument();
    expect(screen.queryByText("Posts")).not.toBeInTheDocument();
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
    expect(screen.queryByText("Instagram")).not.toBeInTheDocument();
    expect(screen.queryByText("Twitter")).not.toBeInTheDocument();
    expect(screen.queryByText("Threads")).not.toBeInTheDocument();
    expect(screen.queryByText("exp.")).not.toBeInTheDocument();
  });

  it("switches composer intent into the approval-safe file request flow", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithClient(<MessageComposer conversationId="local-agent" onSend={onSend} />);

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

  it("hides file-request candidate clutter inside chat approval cards", () => {
    const first = renderWithClient(<ApprovalCardMessage message={makeApprovalMessage()} />);

    expect(screen.getAllByLabelText(/Approval request:/).length).toBeGreaterThan(0);
    expect(screen.getByText("NonPO_Invoice_India.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Harassment Certification.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText("70%")).not.toBeInTheDocument();
    first.unmount();

    const { unmount } = renderWithClient(<ApprovalCardMessage message={makeApprovalMessage({
      candidates: [],
      selected_candidate_id: null,
    })} />);

    expect(screen.queryByText("No candidate files found")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose indexed file" })).not.toBeInTheDocument();
    unmount();
  });

  it("renders compact AI Elements confirmation states for terminal approvals", () => {
    const approved = renderWithClient(<ApprovalCardMessage message={makeApprovalMessage({ status: "approved" })} />);

    expect(screen.getByText("You approved this file transfer")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
    expect(screen.queryByText("Deny")).not.toBeInTheDocument();
    approved.unmount();

    renderWithClient(<ApprovalCardMessage message={makeApprovalMessage({ status: "rejected" })} />);

    expect(screen.getByText("You rejected this file transfer")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
    expect(screen.queryByText("Deny")).not.toBeInTheDocument();
  });

  it("suppresses completed transfer cards in the chat timeline", () => {
    const stored = renderWithClient(<MessageBubble message={makeTransferMessage({ status: "stored" })} />);

    expect(stored.container).toBeEmptyDOMElement();
    expect(screen.queryByText("Transfer complete")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy hash")).not.toBeInTheDocument();
    expect(screen.queryByText("View in Files")).not.toBeInTheDocument();
    expect(screen.queryByText("Verified and stored")).not.toBeInTheDocument();
    stored.unmount();

    const available = renderWithClient(<MessageBubble message={makeTransferMessage({ status: "available" })} />);
    expect(available.container).toBeEmptyDOMElement();
  });

  it("hides file-request rejection system events from timeline rendering", () => {
    expect(isHiddenTimelineMessage({
      kind: "system_event",
      id: "system-1",
      event_type: "warning",
      text: "File request rejected",
      severity: "warning",
      created_at: new Date(0).toISOString(),
    })).toBe(true);

    expect(isHiddenTimelineMessage({
      kind: "system_event",
      id: "system-2",
      event_type: "file_request_rejected",
      text: "Approval declined",
      severity: "warning",
      created_at: new Date(0).toISOString(),
    })).toBe(true);

    expect(isHiddenTimelineMessage({
      kind: "system_event",
      id: "system-3",
      event_type: "transfer_complete",
      text: "File transferred",
      severity: "success",
      created_at: new Date(0).toISOString(),
    })).toBe(false);
  });
});
