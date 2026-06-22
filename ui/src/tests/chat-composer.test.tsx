/// <reference types="vitest/globals" />
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageComposer } from "../components/stream-like/MessageComposer";

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function installComposerRuntimeStyles() {
  const styles = require("fs").readFileSync(
    require("path").resolve(__dirname, "../styles.css"),
    "utf8"
  );
  const start = styles.indexOf(".oa-composer-dock {");
  const end = styles.indexOf("@media (prefers-reduced-motion: reduce)", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const style = document.createElement("style");
  style.id = "composer-runtime-style-test";
  style.textContent = styles.slice(start, end);
  document.head.appendChild(style);
}

class FakeSpeechRecognition extends EventTarget {
  static instance: FakeSpeechRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "en-US";
  onstart: ((this: FakeSpeechRecognition, event: Event) => void) | null = null;
  onend: ((this: FakeSpeechRecognition, event: Event) => void) | null = null;
  onresult: ((this: FakeSpeechRecognition, event: Event & { resultIndex: number; results: unknown[] }) => void) | null = null;
  onerror: ((this: FakeSpeechRecognition, event: Event & { error: string }) => void) | null = null;

  constructor() {
    super();
    FakeSpeechRecognition.instance = this;
  }

  start() {
    this.onstart?.call(this, new Event("start"));
  }

  stop() {
    this.onend?.call(this, new Event("end"));
  }

  emitFinalTranscript(transcript: string) {
    const alternative = { transcript, confidence: 0.93 };
    const result = { 0: alternative, length: 1, isFinal: true, item: () => alternative };
    this.onresult?.call(this, { ...new Event("result"), resultIndex: 0, results: [result] });
  }
}

class FakeMediaRecorder {
  static chunks: Blob[] = [new Blob(["voice audio"], { type: "audio/webm" })];
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    for (const chunk of FakeMediaRecorder.chunks) {
      this.ondataavailable?.({ data: chunk });
    }
    this.state = "inactive";
    this.onstop?.();
  }

  static isTypeSupported() {
    return true;
  }
}

function installVoiceMocks(options: { speechRecognition?: boolean; recordedChunks?: Blob[] } = {}) {
  const { speechRecognition = true, recordedChunks = [new Blob(["voice audio"], { type: "audio/webm" })] } = options;
  FakeSpeechRecognition.instance = null;
  FakeMediaRecorder.chunks = recordedChunks;
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  if (speechRecognition) {
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeSpeechRecognition });
  } else {
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  }
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  });
}

afterEach(() => {
  document.getElementById("composer-runtime-style-test")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeSpeechRecognition.instance = null;
});

describe("MessageComposer source contract", () => {
  it("exports MessageComposer", async () => {
    const mod = await import("../components/stream-like/MessageComposer");
    expect(mod.MessageComposer).toBeDefined();
    expect(typeof mod.MessageComposer).toBe("function");
  });

  it("has aria-label on send button", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../components/stream-like/MessageComposer.tsx"),
      "utf8"
    );
    expect(source).toContain("aria-label");
  });

  it("has keyboard event handling for Enter key", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../components/stream-like/MessageComposer.tsx"),
      "utf8"
    );
    expect(source).toContain("handleKeyDown");
  });

  it("uses the AI prompt shell while preserving chat controls", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../components/stream-like/MessageComposer.tsx"),
      "utf8"
    );
    expect(source).toContain("oa-composer-action-row");
    expect(source).toContain("oa-composer-glow-shell");
    expect(source).toContain("oa-composer-glow-layer");
    expect(source).toContain("aria-hidden=\"true\"");
    expect(source).toContain("ComposerDivider");
    expect(source).toContain("Open command bar");
    expect(source).toContain("Insert emoji");
    expect(source).toContain("EmojiPicker");
    expect(source).toContain("onEmojiClick");
    expect(source).toContain("Mic");
    expect(source).toContain("StopCircle");
    expect(source).toContain("useCreateVoiceCommand");
    expect(source).toContain("transcribeVoiceAudio");
    expect(source).toContain("MediaRecorder");
    expect(source).toContain("data-recording");
    expect(source).toContain("oa-composer-voice-recorder");
    expect(source).toContain("source: \"chat-composer\"");
    expect(source).toContain("input_mode: \"speech\"");
    expect(source).toContain("Array.from({ length: 32 }");
    expect(source).toContain("h-5 w-5");
    expect(source).toContain("data-oa-composer-input");
    expect(source).toContain("SLASH_COMMANDS");
    expect(source).not.toContain("SuggestedPrompts");
    expect(source).not.toContain("DEFAULT_SUGGESTED_PROMPTS");
    expect(source).not.toContain("oa-composer-quick-actions");
    expect(source).not.toContain("Globe");
    expect(source).not.toContain("BrainCog");
    expect(source).not.toContain("FolderCode");
    expect(source).not.toContain("promptMode");
    expect(source).not.toContain("togglePromptMode");
    expect(source).not.toContain("Search mode");
    expect(source).not.toContain("Think mode");
    expect(source).not.toContain("Canvas mode");
  });

  it("uses a CSS-only animated glow around the screenshot-large prompt shell", () => {
    const styles = require("fs").readFileSync(
      require("path").resolve(__dirname, "../styles.css"),
      "utf8"
    );
    expect(styles).toContain(".oa-composer-glow-shell");
    expect(styles).toContain("padding: 0 20px");
    expect(styles).toContain("position: relative");
    expect(styles).toContain(".oa-composer-glow-layer");
    expect(styles).toContain("background: #000000");
    expect(styles).toContain("oa-composer-glow-spin");
    expect(styles).toContain("conic-gradient");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).toContain("min-height: 152px");
    expect(styles).toContain("min-height: 148px");
    expect(styles).toContain(".oa-composer-voice-recorder");
    expect(styles).toContain("min-height: 96px");
    expect(styles).toContain(".oa-composer-voice-visualizer");
    expect(styles).toContain("min-height: 204px");
    expect(styles).toContain("min-height: 200px");
    expect(styles).toContain("min-height: 64px");
    expect(styles).toContain("padding: 26px 30px 10px");
    expect(styles).toContain("width: 48px");
    expect(styles).toContain("height: 48px");
    expect(styles).toContain("width: 2px");
    expect(styles).toContain("height: 34px");
    expect(styles).toContain("width: 2px");
    expect(styles).toContain("height: 40px");
    expect(styles).toContain("bottom: calc(100% + 6px)");
    expect(styles).toContain("pointer-events: none");
    expect(styles).not.toContain(".oa-composer-frame::before");
    expect(styles).not.toContain(".oa-composer-frame::after");
    expect(styles).not.toContain(".oa-composer-quick-actions");
  });

  it("shows the mic primary action while empty and restores send when typing", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithClient(<MessageComposer conversationId="local-agent" onSend={onSend} />);

    expect(screen.getByRole("button", { name: "Start voice command" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "hello composer");

    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSend).toHaveBeenCalledWith("hello composer", "normal");
  });

  it("applies the prompt-box dimensions in the rendered composer cascade", async () => {
    installComposerRuntimeStyles();
    installVoiceMocks();
    const user = userEvent.setup();
    renderWithClient(<MessageComposer conversationId="local-agent" onSend={vi.fn().mockResolvedValue(undefined)} />);

    const shell = document.querySelector<HTMLElement>(".oa-composer-glow-shell");
    const dock = document.querySelector<HTMLElement>(".oa-composer-dock");
    const frame = document.querySelector<HTMLElement>(".oa-composer-frame");
    const inputRow = document.querySelector<HTMLElement>(".oa-composer-input-row");
    const input = document.querySelector<HTMLElement>(".oa-composer-input");
    const primaryAction = screen.getByRole("button", { name: "Start voice command" });
    const iconButton = document.querySelector<HTMLElement>(".oa-composer-icon");
    const divider = document.querySelector<HTMLElement>(".oa-composer-action-divider");

    expect(Number.parseFloat(getComputedStyle(dock!).paddingTop)).toBe(0);
    expect(Number.parseFloat(getComputedStyle(dock!).paddingBottom)).toBe(0);
    expect(shell).toHaveAttribute("data-recording", "false");
    expect(getComputedStyle(shell!).minHeight).toBe("152px");
    expect(getComputedStyle(frame!).minHeight).toBe("148px");
    expect(getComputedStyle(frame!).paddingTop).toBe("14px");
    expect(getComputedStyle(frame!).paddingBottom).toBe("14px");
    expect(getComputedStyle(inputRow!).minHeight).toBe("64px");
    expect(getComputedStyle(input!).minHeight).toBe("64px");
    expect(getComputedStyle(input!).paddingTop).toBe("26px");
    expect(getComputedStyle(input!).paddingRight).toBe("30px");
    expect(getComputedStyle(input!).fontSize).toBe("26px");
    expect(getComputedStyle(input!).lineHeight).toBe("32px");
    expect(getComputedStyle(primaryAction).width).toBe("48px");
    expect(getComputedStyle(primaryAction).height).toBe("48px");
    expect(getComputedStyle(iconButton!).width).toBe("48px");
    expect(getComputedStyle(iconButton!).height).toBe("48px");
    expect(getComputedStyle(divider!).width).toBe("2px");
    expect(getComputedStyle(divider!).height).toBe("34px");
    expect(document.querySelector(".oa-composer-icon svg")).toHaveClass("h-5", "w-5");
    expect(screen.getByRole("button", { name: "Open command bar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Insert emoji" })).toBeInTheDocument();

    await user.click(primaryAction);

    expect(shell).toHaveAttribute("data-recording", "true");
    expect(getComputedStyle(shell!).minHeight).toBe("204px");
    expect(getComputedStyle(frame!).minHeight).toBe("200px");
    const visualizer = document.querySelector<HTMLElement>(".oa-composer-voice-visualizer");
    const recorder = document.querySelector<HTMLElement>(".oa-composer-voice-recorder");
    const bars = document.querySelectorAll<HTMLElement>(".oa-composer-voice-visualizer span");
    expect(getComputedStyle(recorder!).minHeight).toBe("96px");
    expect(getComputedStyle(visualizer!).height).toBe("40px");
    expect(bars).toHaveLength(32);
    expect(getComputedStyle(bars[0]).width).toBe("2px");
  });

  it("expands while recording and submits a captured voice command transcript", async () => {
    installVoiceMocks();
    const fetchCalls: Array<[RequestInfo | URL, RequestInit?]> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push([input, init]);
      return new Response(JSON.stringify({ command: { id: "vc_1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderWithClient(<MessageComposer conversationId="local-agent" onSend={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Start voice command" }));

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop voice command" })).toBeInTheDocument();
    expect(document.querySelector(".oa-composer-glow-shell")?.getAttribute("data-recording")).toBe("true");

    await act(async () => {
      FakeSpeechRecognition.instance?.emitFinalTranscript("Ask Docin to send invoice pdf");
    });
    await user.click(screen.getByRole("button", { name: "Stop voice command" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/voice/commands", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start voice command" })).toBeInTheDocument());
    const [, init] = fetchCalls[0];
    const request = JSON.parse(String(init?.body));
    expect(request).toMatchObject({
      transcript: "Ask Docin to send invoice pdf",
      source: "chat-composer",
      input_mode: "speech",
      stt: {
        provider: "browser",
      },
    });
    expect(fetchCalls.some(([input]) => String(input) === "/voice/transcribe")).toBe(false);
  });

  it("falls back to recorded audio transcription when browser speech returns no transcript", async () => {
    installVoiceMocks();
    const fetchCalls: Array<[RequestInfo | URL, RequestInit?]> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push([input, init]);
      if (String(input) === "/voice/transcribe") {
        return new Response(JSON.stringify({
          transcript: "Request harassment certification from Docin",
          provider: "local",
          confidence: 0.88,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ command: { id: "vc_2" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderWithClient(<MessageComposer conversationId="local-agent" onSend={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Start voice command" }));
    await user.click(screen.getByRole("button", { name: "Stop voice command" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/voice/transcribe", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/voice/commands", expect.objectContaining({ method: "POST" })));
    const transcribeRequest = JSON.parse(String(fetchCalls.find(([input]) => String(input) === "/voice/transcribe")?.[1]?.body));
    expect(transcribeRequest).toMatchObject({
      source: "chat-composer",
    });
    expect(transcribeRequest.mimeType).toContain("audio/webm");
    const commandRequest = JSON.parse(String(fetchCalls.find(([input]) => String(input) === "/voice/commands")?.[1]?.body));
    expect(commandRequest).toMatchObject({
      transcript: "Request harassment certification from Docin",
      source: "chat-composer",
      input_mode: "speech",
      stt: {
        provider: "local",
        confidence: 0.88,
      },
    });
  });

  it("uses recorded audio transcription when SpeechRecognition is unsupported", async () => {
    installVoiceMocks({ speechRecognition: false });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/voice/transcribe") {
        return new Response(JSON.stringify({ transcript: "Open inbox", provider: "local" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ command: { id: "vc_3" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithClient(<MessageComposer conversationId="local-agent" onSend={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Start voice command" }));
    await user.click(screen.getByRole("button", { name: "Stop voice command" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/voice/transcribe", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/voice/commands", expect.objectContaining({ method: "POST" })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no-speech only when browser and audio transcription are both empty", async () => {
    installVoiceMocks({ speechRecognition: false, recordedChunks: [] });
    const user = userEvent.setup();
    renderWithClient(<MessageComposer conversationId="local-agent" onSend={vi.fn().mockResolvedValue(undefined)} />);

    await user.click(screen.getByRole("button", { name: "Start voice command" }));
    await user.click(screen.getByRole("button", { name: "Stop voice command" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No speech was detected. Try again when you are ready.");
  });
});

describe("ComposerDock source contract", () => {
  it("exports ComposerDock", async () => {
    const mod = await import("../features/chat/ComposerDock");
    expect(mod.ComposerDock).toBeDefined();
    expect(typeof mod.ComposerDock).toBe("function");
  });
});

describe("ChatWindow source contract", () => {
  it("exports ChatWindow", async () => {
    const mod = await import("../features/chat/ChatWindow");
    expect(mod.ChatWindow).toBeDefined();
    expect(typeof mod.ChatWindow).toBe("function");
  });

  it("sends normal messages immediately and reserves confirmation for file requests", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/chat/ChatWindow.tsx"),
      "utf8"
    );
    expect(source).toContain("SendConfirmation");
    expect(source).toContain("pendingSend");
    expect(source).toContain("sendAs === \"normal\"");
    expect(source).toContain("sendMessage.mutateAsync({ text, clientMessageId: crypto.randomUUID() })");
    expect(source).toContain("setPendingSend({ text, sendAs })");
  });
});
