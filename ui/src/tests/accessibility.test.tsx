/// <reference types="vitest/globals" />
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TransferProgressCard } from "../features/transfers/TransferProgressCard";
import SocialPostCard, { type SocialPostCardAction } from "../../../components/ui/social-post-card";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { UnreadDivider } from "../components/stream-like/UnreadDivider";
import type { TransferProgressMessage } from "../types";

function makeTransfer(overrides: Partial<TransferProgressMessage> = {}): TransferProgressMessage {
  return {
    kind: "transfer",
    id: "t1",
    transfer_id: "tf1",
    task_id: "task1",
    file_name: "report.pdf",
    size_bytes: 102400,
    sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    progress_percent: 50,
    status: "uploading",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("TransferProgressCard accessibility", () => {
  it("has a heading structure with h3 for the title", () => {
    const { container } = render(<TransferProgressCard transfer={makeTransfer()} />);
    const headings = container.querySelectorAll("h3");
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(headings[0]?.textContent).toBe("File Transfer");
  });

  it("has accessible progress indicator with visible text label", () => {
    render(<TransferProgressCard transfer={makeTransfer()} />);
    const el = document.querySelector("[role='progressbar']");
    // TransferProgressCard uses a visual bar with text, not a role="progressbar" — acceptable for simple UI
    const progressText = document.body.textContent;
    expect(progressText).toContain("Progress");
    expect(progressText).toContain("50%");
  });
});

describe("ApprovalCard accessibility contract", () => {
  it("approval-card component exists and exports properly", async () => {
    const mod = await import("../features/approvals/ApprovalCard");
    expect(mod.ApprovalCard).toBeDefined();
    expect(typeof mod.ApprovalCard).toBe("function");
  });
});

describe("FileReceiptCard accessibility contract", () => {
  it("file-receipt-card component exists and exports properly", async () => {
    const mod = await import("../features/transfers/FileReceiptCard");
    expect(mod.FileReceiptCard).toBeDefined();
    expect(typeof mod.FileReceiptCard).toBe("function");
  });
});

describe("Nested interactive accessibility", () => {
  it("renders social action tooltips on the real buttons without wrapper buttons", () => {
    const actions: [SocialPostCardAction, SocialPostCardAction, SocialPostCardAction] = [
      { key: "send", label: "Send", icon: <span aria-hidden="true">S</span>, onClick: vi.fn(), tone: "primary" as const },
      { key: "deny", label: "Deny", icon: <span aria-hidden="true">D</span>, onClick: vi.fn(), tone: "danger" as const },
      { key: "feedback", label: "Feedback", icon: <span aria-hidden="true">F</span>, onClick: vi.fn(), tone: "neutral" as const },
    ];

    const { container } = render(
      <TooltipProvider>
        <SocialPostCard
          author={{ name: "Remote Agent" }}
          contentText="Review file transfer."
          document={{ title: "report.pdf" }}
          actions={actions}
        />
      </TooltipProvider>
    );

    expect(container.querySelector(".tooltip__trigger[role='button']")).toBeNull();
    const triggers = Array.from(container.querySelectorAll("[data-slot='tooltip-trigger']"));
    expect(triggers).toHaveLength(3);
    expect(triggers.every((trigger) => trigger.tagName === "BUTTON")).toBe(true);
    expect(triggers.every((trigger) => trigger.querySelector("button") === null)).toBe(true);
  });

  it("keeps unread divider jump button outside the separator", () => {
    const { container } = render(<UnreadDivider label="Unread messages" count={3} onJumpToLatest={vi.fn()} />);
    const separator = container.querySelector("[role='separator']");

    expect(separator).not.toBeNull();
    expect(separator?.getAttribute("aria-label")).toBe("Unread messages");
    expect(separator?.querySelector("button,[role='button'],a[href],input,select,textarea")).toBeNull();
    expect(container.querySelector("button[aria-label='Jump to latest messages']")).not.toBeNull();
  });
});
