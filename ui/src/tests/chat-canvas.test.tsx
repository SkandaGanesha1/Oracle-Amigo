/// <reference types="vitest/globals" />
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ChatCanvas, ChatCanvasEmptyState, ChatCanvasErrorState, ChatCanvasLoadingState } from "../features/chat/ChatCanvas";
import { MessageComposer } from "../components/stream-like/MessageComposer";

const ROOT = resolve(__dirname, "../../..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("Discord-like ChatCanvas", () => {
  it("is wired at the shared chat route level", () => {
    const routes = read("ui/src/app/routes.tsx");
    const main = read("ui/src/features/chat/MainChatLayout.tsx");

    expect(routes).toContain('<Route path="/chats" element={<MainChatLayout />} />');
    expect(routes).toContain('<Route path="/chats/:conversationId" element={<MainChatLayout />} />');
    expect(routes).toContain('<Route path="/chat/:conversationId" element={<ChatRedirect />} />');
    expect(routes).toContain('<Route path="/chat" element={<ChatRedirect />} />');
    expect(main).toContain('from "./ChatCanvas"');
    expect(main).toContain("<ChatCanvas");
    expect(main).toContain("timeline={timeline}");
    expect(main).toContain("emptyState={emptyState}");
    expect(main).toContain("loadingState={loadingState}");
    expect(main).toContain("errorState={errorState}");
    expect(main).not.toContain("inspector={inspector}");
    expect(routes).toContain('from "../features/loading/AmigoLogoLoader"');
    expect(routes).toContain("<AmigoLogoLoader");
    expect(main).toContain("const isEmptyConversation = Boolean");
    expect(main).toContain("messages.length === 0");
    expect(main).toContain("emptyState={emptyConversationState}");
  });

  it("routes empty existing conversations through the Discord beginning state while keeping ChatWindow composer logic", () => {
    const main = read("ui/src/features/chat/MainChatLayout.tsx");
    const chatWindow = read("ui/src/features/chat/ChatWindow.tsx");

    expect(main).toContain("const emptyConversationState = isEmptyConversation");
    expect(main).toContain("This is the beginning of your conversation with");
    expect(main).toContain("<ChatWindow");
    expect(main).toContain("emptyState={emptyConversationState}");
    expect(chatWindow).toContain("emptyState?: ReactNode");
    expect(chatWindow).toContain("!loading && chatMessages.length === 0 && emptyState");
    expect(chatWindow.indexOf("emptyState")).toBeLessThan(chatWindow.indexOf("<MessageTimeline"));
    expect(chatWindow).toContain("<ComposerDock");
  });

  it("renders existing-chat slots inside the reusable canvas", () => {
    render(
      <ChatCanvas
        header={<header>My local agent</header>}
        timeline={<div role="log">Hello from history</div>}
        composer={<label>Composer<input aria-label="Composer" /></label>}
      />
    );

    expect(screen.getByTestId("discord-chat-canvas")).toBeInTheDocument();
    expect(screen.getByText("My local agent")).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("Hello from history");
    expect(screen.getByRole("textbox", { name: "Composer" })).toBeInTheDocument();
  });

  it("renders new-chat empty state with global entry actions", async () => {
    const user = userEvent.setup();
    const onSearchDirectory = vi.fn();
    const onOpenLocalAgent = vi.fn();
    const onOpenApprovals = vi.fn();

    render(
      <ChatCanvas
        emptyState={
          <ChatCanvasEmptyState
            onSearchDirectory={onSearchDirectory}
            onOpenLocalAgent={onOpenLocalAgent}
            onOpenApprovals={onOpenApprovals}
          />
        }
      />
    );

    expect(screen.getByTestId("chat-canvas-empty")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Search directory" }));
    await user.click(screen.getByRole("button", { name: "Open local agent" }));
    await user.click(screen.getByRole("button", { name: "Review approvals" }));
    expect(onSearchDirectory).toHaveBeenCalledTimes(1);
    expect(onOpenLocalAgent).toHaveBeenCalledTimes(1);
    expect(onOpenApprovals).toHaveBeenCalledTimes(1);
  });

  it("renders loading and error states with stable selectors", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ChatCanvas loadingState={<ChatCanvasLoadingState />} />);
    expect(screen.getByTestId("chat-canvas-loading")).toHaveTextContent("Loading conversation...");
    expect(screen.getByTestId("amigo-logo-loader")).toBeInTheDocument();

    rerender(
      <ChatCanvas
        errorState={
          <ChatCanvasErrorState
            title="Conversation failed to load"
            message="Retry the local session."
            onRetry={onRetry}
          />
        }
      />
    );
    expect(screen.getByTestId("chat-canvas-error")).toHaveTextContent("Conversation failed to load");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps the existing composer usable inside the canvas", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithClient(<MessageComposer conversationId="local-agent" onSend={onSend} />);

    await user.type(screen.getByRole("textbox"), "hello canvas");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSend).toHaveBeenCalledWith("hello canvas", "normal");
  });

  it("uses chat theme tokens instead of hardcoded Discord values in component styling", () => {
    const styles = read("ui/src/styles.css");
    const chatCanvas = read("ui/src/features/chat/ChatCanvas.tsx");
    const main = read("ui/src/features/chat/MainChatLayout.tsx");
    const composerSendRule = styles.match(/\.oa-composer-send\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const transferFillRule = styles.match(/\.oa-transfer-progress-fill\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(styles).toContain("--oa-chat-accent: #5865f2");
    expect(styles).toContain("--oa-chat-safe: #35ed7e");
    expect(styles).toContain('--oa-chat-bg: #f4f5fb');
    expect(styles).toContain('[data-theme="high-contrast"]');
    expect(composerSendRule).toContain("background: #f8fafc");
    expect(transferFillRule).toContain("background: var(--oa-chat-accent)");
    expect(`${chatCanvas}\n${main}`).not.toContain("#5865f2");
  });
});
